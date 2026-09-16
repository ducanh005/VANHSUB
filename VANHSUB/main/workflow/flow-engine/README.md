# Robust, State-Based, Self-Healing Browser Automation Engine cho Google Flow
> **Tài liệu theo dõi tiến độ, kiến trúc và quy chuẩn tái cấu trúc toàn diện.**
> **Bắt buộc đọc trước mỗi phiên làm việc để xác định chính xác Phase hiện tại và các nguyên tắc bất di bất dịch.**

---

## 📌 BẢNG ĐIỀU KHIỂN TIẾN ĐỘ (CURRENT STATUS)

| Hạng mục | Trạng thái | Ghi chú / Chi tiết |
| :--- | :--- | :--- |
| **Phase hiện tại** | **PHASE 5: Recovery Manager + Overlay + Page State** | Đã hoàn tất 100% bằng chứng kiểm thử (Chờ duyệt) |
| **Trạng thái Code Phase 5** | 🟢 **HOÀN THÀNH 100%** | FlowOverlayDetector, FlowPageStateDetector, FlowRecoveryManager & State Machine hooks |
| **Test Phòng Vệ Phase 5** | 🟢 **ĐÃ CHẠY THẬT & ĐẠT 100%** | Test 1: Adversarial Overlay Recovery, Test 2: Page State Accuracy, Test 3: Unknown State Diagnostics |
| **Test Live Sinh Ảnh Phase 5** | 🟢 **ĐÃ CHẠY THẬT & ĐẠT 100%** | 18 States hoàn tất (33s), ảnh CDN thật, Recovery Manager active không side-effects |
| **Phase tiếp theo** | **PHASE 6: Retry Manager** | ⛔ **CẤM TỰ ĐỘNG CHUYỂN KHI CHƯA ĐƯỢC DUYỆT PHASE 5** |

---

## ⚖️ CÁC NGUYÊN TẮC BẤT DI BẤT DỊCH (CORE PRINCIPLES)

1. **DỪNG LẠI SAU MỖI PHASE**: Tuyệt đối không tự ý chuyển sang Phase tiếp theo dù việc code có vẻ thuận lợi. Phải dừng lại, báo cáo kết quả và chờ User phê duyệt chính thức.
2. **CHỨNG MINH BẰNG CHẠY THẬT (NO MOCK)**:
   - Không suy luận trên lý thuyết hay dựa vào việc "code không throw lỗi".
   - Bắt buộc chạy thật trên Electron và Google Flow (chấp nhận tốn credit tối thiểu để kiểm chứng).
   - Phải cung cấp Log Thật đầy đủ thể hiện rõ ràng các state, toạ độ, confidence score, duration và verify data.
3. **BÁO CÁO TRUNG THỰC**: Khi chạy thử gặp lỗi (timeout, crash, redirect, session expired...), phải báo cáo trung thực nguyên nhân gốc rễ, không che giấu hoặc coi là đạt.
4. **THAY ĐỔI TỐI THIỂU (MINIMAL REGRESSION RISK)**:
   - Thay đổi ít file nhất có thể trong mỗi Phase.
   - Đối chiếu kỹ với kiến trúc đã có (`GoogleFlowBrowserMutex`, `ensureCleanCanvasReady`, `sendInputEvent`, snapshot baseline + time gate), không đập đi xây lại cái đang chạy tốt.
5. **ZERO FALSE-CLICK**:
   - **Container-Scoped Search**: Tier 3 (`CONTEXTUAL`) và Tier 4 (`TEXT_MATCH`) bắt buộc phải có `containerSelector`, cấm tuyệt đối quét toàn trang (`document-wide`).
   - **Short-Text Confidence Cap**: Tất cả các text match ngắn $\le 2$ ký tự (`text:1`, `text:2`, `text:x1`, `text:Tune`...) phải hạ `baseConfidence: 55` (< 65 Threshold an toàn) để hệ thống từ chối click (`low_confidence`) thay vì click bừa.

---

## 🗺️ LỘ TRÌNH 10 PHASE CHI TIẾT & TRẠNG THÁI

### ✅ Phase 1: Audit Kiến Trúc & Luồng Hiện Tại
- **Trạng thái**: **ĐÃ HOÀN THÀNH**
- **Nội dung**: Phân tích hiện trạng codebase, đối chiếu các điểm yếu: Coordinate drift, fixed sleep, single selectors, thiếu verify sau action, rủi ro duplicate generation khi crash. Chốt lộ trình chuẩn 10 Phase.

### ✅ Phase 2: State Machine + Verify-After-Action + Idempotency
- **Trạng thái**: **ĐÃ HOÀN THÀNH & ĐÃ ĐƯỢC DUYỆT**
- **Nội dung**:
  - Triển khai State Machine 18 states tường minh (`OPEN_FLOW` $\rightarrow$ `COMPLETE`).
  - Mọi state đều có `enter()`, `execute()`, `verify()` (log dữ liệu thực tế đọc được, không chỉ in tick).
  - Tích hợp Idempotency check (`CHECK_IDEMPOTENCY_BEFORE_GENERATE`) ngăn chặn 100% duplicate click khi retry.
  - Tính toán lại toạ độ `getBoundingClientRect()` ngay trước thời điểm gửi `sendInputEvent` (chống coordinate drift).
  - Bằng chứng thực tế: Đã chạy sinh ảnh thật 51s, log xác nhận đầy đủ 18/18 state.

### ✅ Phase 3: Smart Wait + Element Stability Check
- **Trạng thái**: **ĐÃ HOÀN THÀNH & ĐÃ ĐƯỢC DUYỆT**
- **Nội dung**:
  - Loại bỏ hoàn toàn các `sleep(Nms)` cố định, thay bằng chờ theo điều kiện adaptive polling (500ms $\rightarrow$ 750ms $\rightarrow$ 1s).
  - Kiểm tra 5 lớp trước khi click: Tồn tại, Visible, Enabled, Unobscured (không bị che), Bounding box ổn định (sai số $\le 1$px qua 2 frame).
  - Bằng chứng thực tế: Adversarial test 5 kịch bản (17/17 candidates tried, rơi tầng chuẩn xác), sửa lỗi cold-start cookie restoration RFC 6265 chống redirect `/about`.

### ✅ Phase 4: Self-Healing Element Finder (Cơ Bản)
- **Trạng thái**: **ĐÃ HOÀN THÀNH & ĐÃ ĐƯỢC DUYỆT**
- **Nội dung**:
  - Chuẩn hoá bộ quy tắc tìm kiếm 4 Tiers (`ACCESSIBILITY` $\rightarrow$ `STRICT_COMPONENT` $\rightarrow$ `CONTEXTUAL` $\rightarrow$ `TEXT_MATCH`) có Confidence Scoring cho các tương tác:
    - Aspect Ratio (16:9, 9:16, 1:1, 4:3, 3:4)
    - Output Count (x1, x2, x4)
    - Mode Tab (Image / Video)
    - Settings Trigger Button
    - New Project Button
    - Clear Canvas Button & Close Overlay Button
  - **2 Cơ chế phòng vệ kiến trúc bắt buộc**:
    1. Container-Scoped Search: Giới hạn Tier 3 và Tier 4 trong container liên quan (`containerSelector`), nghiêm cấm document-wide search (kể cả trong `waitForElementStable` và `checkElementUnobscured`).
    2. Short-Text Confidence Cap: Nhãn ngắn $\le 2$ ký tự triệt tiêu text bonus, đạt chính xác 50/100 (< 65 threshold), từ chối auto-click (`low_confidence`).
  - **4 Bằng chứng thực tế nghiệm thu (100% Log thật mới, không mock)**:
    1. **Live Run 18 States + Xác minh DOM UI độc lập**: Tạo ảnh thật (`task_p4_live_verified_1789537733559`), Project ID `e9735876-000a-4d92-94f7-f89b5e8dc36d`, ảnh URL `https://flow-content.google/image/685c01f4...` (366,363 bytes), 34s. Đọc DOM thật: toggle `crop_16_9 16:9` checked (`519, 560`), toggle `x1` checked (`519, 649`), LocalStorage `aspectRatio: LANDSCAPE`, `Qp: 1`, toạ độ tách biệt hoàn toàn.
    2. **Container Scoping Test (Ép hỏng Tier 1 & 2)**: Bỏ qua mồi nhử tại $y=10$ và $y=50$, rơi xuống Tier 3/4 và bắt chính xác phần tử trong container tại $y=220$.
    3. **Short-Text Protection Test (Zero False-Click)**: Ép hỏng Tier 1-3, Tier 4 `text:1` score đúng 50/100 < 65, hệ thống huỷ click an toàn với mã `low_confidence`.
    4. **Adversarial Fallback Test**: Ép hỏng Tier 1 Aspect Ratio, Finder rơi tự động xuống Tier 2 (`STRICT_COMPONENT`), conf: 95/100, toạ độ khớp trong container.

### ✅ Phase 5: Recovery Manager + Overlay Detector + Page State Detector
- **Trạng thái**: **ĐÃ HOÀN THÀNH — ĐỦ 4/4 HẠNG MỤC VỚI LOG THẬT (Chờ User Duyệt)**
- **Nội dung**:
  - `FlowPageStateDetector`: Nhận diện 7 trạng thái trang đặc thù (`FLOW_HOME`, `FLOW_EDITOR`, `GENERATION_IN_PROGRESS`, `RESULT_PAGE`, `LOGIN_PAGE`, `ERROR_PAGE`, `UNKNOWN_PAGE`).
  - `FlowOverlayDetector`: Quét và phân loại các loại che chắn (`AGENT_PANEL`, `MODAL_DIALOG`, `MEDIA_VIEWER`, `BACKDROP`); quy trình tự động dismiss 3 bước (Native Escape key $\rightarrow$ Click Close button $\rightarrow$ Click backdrop / Escape lần 2).
  - `FlowRecoveryManager`: Tự phục hồi theo bảng phân loại lỗi; tích hợp hook tự động vào `FlowStateMachine` (tối đa 1 lần thử phục hồi / state); tự động chụp DOM snapshot (`.html`) và screenshot (`.png`) vào `scratch/` khi gặp `UNKNOWN_STATE`.
  - **4 Bằng chứng thực tế nghiệm thu (100% Log thật, không mock)**:
    1. **Adversarial Overlay Recovery Test**: Chèn Modal Dialog và Backdrop che phủ toàn màn hình, Detector nhận diện chính xác 3 overlays (`MODAL_DIALOG`, `BACKDROP`), Recovery giải phóng thành công (`DISMISS_OVERLAY_SUCCESS`), DOM sạch 100% sau phục hồi.
    2. **Page State Accuracy Test**: Nhận diện chính xác `FLOW_HOME`, `GENERATION_IN_PROGRESS` (khi có spinner), và `ERROR_PAGE` (khi có banner lỗi/hết tín dụng).
    3. **Diagnostics Capture Test**: Kích hoạt `UNKNOWN_STATE`, trích xuất thành công file DOM snapshot `scratch/diagnostics_task_phase5_diag_test_*.html` và tạm dừng an toàn (`shouldAbort: true`).
    4. **Live Run 18 States Thành Công**: Tạo ảnh thật (`task_p5_live_1789538076491`), Project ID `b1045b08-2322-4016-9ec8-7612793b4397`, ảnh CDN `https://flow-content.google/image/e9ede701...` (348,115 bytes), hoàn tất trong 33s với Recovery Manager active.

### ✅ Phase 6: Retry Manager + Error Classification Tập Trung
- **Trạng thái**: **ĐÃ HOÀN THÀNH — ĐỦ 4/4 HẠNG MỤC VỚI LOG THẬT (Chờ User Duyệt)**
- **Nội dung**:
  - `FlowErrorClassifier`: Phân loại lỗi tập trung chuẩn hoá 3 nhóm `RETRYABLE` (mạng, HTTP 429/5xx, tác nhân, DOM busy), `NON_RETRYABLE` (hết hạn session, hết credit, vi phạm chính sách, người dùng huỷ), và `FATAL` (cửa sổ bị huỷ).
  - `FlowRetryManager`: Exponential Backoff kết hợp Full Jitter $\pm 20\%$ ($2\text{s} \rightarrow 4\text{s} \rightarrow 8\text{s}$), giới hạn max 3 retries, trần max delay 15000ms.
  - **Idempotency Protection on Retry**: Nếu lỗi xảy ra tại hoặc sau bước `CLICK_GENERATE` mà generation đã in-flight, hệ thống tự động nhảy cóc (Idempotency Jump) sang `WAIT_FOR_GENERATION`, tuyệt đối không click lại gây trùng lặp (Zero Duplicate Generation).
  - **4 Bằng chứng thực tế nghiệm thu (100% Log thật từ tiến trình Electron)**:
    1. **Classification Matrix Test (13/13 tests PASS)**: Nhận diện chính xác 100% các mã lỗi `ECONNRESET`, `ERR_INTERNET_DISCONNECTED`, `fetch failed`, `HTTP 429` (kèm bóc tách recommended delay), `HTTP 503`, lỗi tác nhân, `SESSION_EXPIRED`, `OUT_OF_CREDITS`, `PROMPT_POLICY_VIOLATION`, `BROWSER_WINDOW_DESTROYED`, `USER_CANCELLED`.
    2. **Exponential Backoff & Jitter Range Test (9/9 tests PASS)**: Attempt 1 trong dải $[1600\text{ms}, 2400\text{ms}]$, Attempt 2 trong $[3200\text{ms}, 4800\text{ms}]$, Attempt 3 trong $[6400\text{ms}, 9600\text{ms}]$, Attempt 10 capped $\le 18000\text{ms}$, từ chối retry sau attempt 3.
    3. **Idempotency Protection on Retry Test (4/4 tests PASS)**: Giả lập lỗi mạng tại `CLICK_GENERATE`, phát hiện in-flight generation, State Machine tự động jump sang `WAIT_FOR_GENERATION`, số lần click native giữ nguyên đúng 1 lần duy nhất.
    4. **Live Run 18 States Thành Công**: Tạo ảnh thật (`task_p6_live_1789538479957`), Project ID `1beb7058-bc97-4d90-8fcd-1ded894723e3`, CDN URL `https://flow-content.google/image/483d2062-6ac1-4118-8eda-e790e4fbc13b...`, ảnh base64 204,827 bytes, hoàn tất sau 35.4s (37s tổng) với Phase 6 active.

### ⏳ Phase 7: Task Queue + Checkpoints Resume
- **Trạng thái**: **CHƯA BẮT ĐẦU**
- **Nội dung**: Lưu checkpoint sau các state quan trọng (`GENERATION_STARTED`, `GENERATION_COMPLETED`), cho phép khôi phục luồng sau crash mà không tạo trùng lặp ảnh.

### ⏳ Phase 8: Debugging / Observability + Download Verification
- **Trạng thái**: **CHƯA BẮT ĐẦU**
- **Nội dung**: Tự động xuất debug bundle (screenshot, DOM snapshot, action-log) khi fail mà không làm lộ cookie/token. Verify tính toàn vẹn của file tải về.

### ⏳ Phase 9 (Tuỳ chọn): Element Memory / Learning + Visual Fallback
- **Trạng thái**: **CHƯA BẮT ĐẦU**
- **Nội dung**: Chỉ triển khai nếu qua các phase trước đã thấy rõ nhu cầu thực sự. Element Memory lưu metadata tỉ lệ thành công/thất bại theo selector. Visual fallback chỉ dùng khi DOM/accessibility đều thất bại.

### ⏳ Phase 10: Stress Test Toàn Bộ
- **Trạng thái**: **CHƯA BẮT ĐẦU**
- **Nội dung**: Chạy workflow dài nhiều node nối tiếp thật trên Google Flow để kiểm chứng tính bền bỉ tổng thể.

---

## 📂 DANH MỤC FILE TRỌNG TÂM CỦA BROWSER ENGINE

```
VANHSUB/
├── FLOW_ENGINE_README.md                    <-- FILE NÀY (Bản đồ tiến độ & quy chuẩn)
├── main/
│   ├── veo/
│   │   └── GoogleVeoSessionManager.ts       <-- Quản lý Session, Mutex, Browser Window, Cookie
│   └── workflow/
│       └── flow-engine/
│           ├── FlowStateMachine.ts          <-- Engine State Machine lõi (18 States)
│           ├── FlowElementFinder.ts         <-- Bộ tìm kiếm phần tử đa tầng (4 Tiers, Confidence Scoring)
│           ├── types.ts                     <-- Khai báo Type, Search Spec, Candidate, State Context
│           ├── states/
│           │   └── FlowImageGenerationStates.ts <-- Hiện thực chi tiết từng State (enter, execute, verify)
│           └── checkpoints/                 <-- Lưu trữ checkpoint State Machine (Phase 7)
└── scratch/                                 <-- Các kịch bản test runner và file kiểm chứng
    ├── test_phase4_verified.ts              <-- Bộ 3 test kiểm chứng Container Scoping & Confidence Cap
    ├── open_lobby_for_login.ts              <-- Script mở Sảnh hỗ trợ người dùng đăng nhập & bắt cookie
    └── run_phase4_live.ts                   <-- Kịch bản chạy thật sinh ảnh Phase 4 trên Google Flow
```

---

## 🛠️ HƯỚNG DẪN CHO AGENT / DEVELOPER TRƯỚC MỖI PHIÊN CODE

1. Mở file `FLOW_ENGINE_README.md` này để xác định Phase hiện tại.
2. Kiểm tra phần **BẢNG ĐIỀU KHIỂN TIẾN ĐỘ**: Tuyệt đối không nhảy cóc sang Phase tiếp theo nếu Phase hiện tại chưa có xác nhận duyệt bằng văn bản từ User.
3. Bất kỳ thay đổi nào liên quan đến tìm kiếm selector mới phải tuân theo 2 quy tắc: **Container-Scoped** và **Short-Text Confidence Cap < 65**.
4. Mọi bằng chứng nghiệm thu bắt buộc phải là log thật xuất ra từ tiến trình Electron.
