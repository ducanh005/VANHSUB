# BÁO CÁO KIỂM TOÁN CHUYÊN SÂU: ERROR CLASSIFIER, RETRY, RECOVERY & IDEMPOTENCY JUMP (TRACK 3)

> **Tóm tắt cốt lõi**: Hệ thống Google Flow Engine (Phase 5-6) đã thiết lập được nền tảng State Machine với mô hình 3 lớp (DOM Healing, Error Classifier, Retry Manager) và cơ chế Idempotency Jump ban đầu rất tiến bộ cho sinh ảnh; tuy nhiên hệ thống đang tồn tại 5 lỗ hổng kiến trúc nghiêm trọng: **(1)** Thứ tự xử lý lỗi bị đảo ngược khiến mọi lỗi mạng/timeout đều kích hoạt dump DOM/screenshot rác; **(2)** Khoảng trống thời gian (timing gap) giữa click DOM và set cờ trạng thái làm vô hiệu hoá Idempotency Guard gây duplicate click; **(3)** Lớp Video (`generateVideoViaBrowserContext`) hoàn toàn chưa được migrate sang State Machine, thiếu 100% Idempotency Guard và retry mù quáng làm tốn quota Veo; **(4)** Xung đột 3 hệ thống lock/concurrency độc lập (`GoogleFlowBrowserMutex`, `GoogleVeoAntiSpamGuard`, `OnlineImageRateLimiter`); và **(5)** Rò rỉ dung lượng ổ cứng không giới hạn trong thư mục `process.cwd()/scratch` cùng nguy cơ sập ứng dụng đóng gói do ghi sai phân vùng.

---

## 1. OBSERVATION (Dữ Liệu Quan Sát Thực Tế Trích Xuất Từ Source Code)

### 1.1. FlowErrorClassifier.ts: Phân Loại Lỗi & Độ Phủ Taxonomy

File: `main/workflow/flow-engine/FlowErrorClassifier.ts` (327 dòng).
Hệ thống định nghĩa 3 nhóm lỗi `ErrorCategory`: `'FATAL' | 'NON_RETRYABLE' | 'RETRYABLE'` và 13 mã lỗi `FlowErrorCode` (lines 30–325).

| STT | Mã Lỗi (`FlowErrorCode`) | Category | `canRetry` | Dòng Code | Dấu Hiệu Nhận Biết (Matching Patterns) | Đánh Giá Độ Phủ & Rủi Ro |
|---|---|---|---|---|---|---|
| 1 | `BROWSER_WINDOW_DESTROYED` | `FATAL` | `false` | lines 30–47 | `ctx?.win.isDestroyed()`, `'object has been destroyed'`, `'window is destroyed'`, `'render process gone'` | ✅ Chính xác, bảo vệ sập tiến trình Electron kịp thời. |
| 2 | `USER_CANCELLED` | `NON_RETRYABLE` | `false` | lines 49–66 | `ctx?.isCancelled?.()`, `'cancelled'`, `'đã bị huỷ bởi người dùng'`, `'abort controller'` | ✅ Nhận diện đầy đủ tín hiệu ngắt từ người dùng. |
| 3 | `SESSION_EXPIRED` | `NON_RETRYABLE` | `false` | lines 68–98 | URL chứa `flow.google.com/about`, `accounts.google.com`, `servicelogin`; `pageState === 'LOGIN_PAGE'`; chuỗi `'session expired'`, `'unauthorized'`, `'status: 401'`, `'status: 403'` | ⚠️ Chưa bắt trường hợp Google Bot Challenge / Recaptcha redirect (`google.com/sorry/index`). |
| 4 | `OUT_OF_CREDITS` | `NON_RETRYABLE` | `false` | lines 100–119 | `'out of credits'`, `'hết tín dụng'`, `'không đủ số dư'`, `'insufficient credits'`, `'zero balance'` | ✅ Đầy đủ cho các thông báo giao diện tiếng Anh và tiếng Việt. |
| 5 | `PROMPT_POLICY_VIOLATION` | `NON_RETRYABLE` | `false` | lines 121–145 | `'policy violation'`, `'safety filter'`, `'blocked by safety'`, `'sensitive content'`, `'tiêu chuẩn cộng đồng'` | ✅ Phân loại đúng thành `NON_RETRYABLE`, dừng sinh vô ích. |
| 6 | `ACCOUNT_SUSPENDED` | `NON_RETRYABLE` | `false` | lines 147–164 | `'account suspended'`, `'tài khoản bị tạm khoá'`, `'account disabled'`, `'account terminated'` | ✅ Dừng an toàn. |
| 7 | `INVALID_INPUT` | `NON_RETRYABLE` | `false` | lines 166–183 | `'prompt rỗng'`, `'prompt is empty'`, `'invalid prompt'`, `'malformed input'` | ✅ Dừng an toàn. |
| 8 | `RATE_LIMIT_429` | `RETRYABLE` | `true` | lines 185–209 | `'429'`, `'too many requests'`, `'quá nhiều yêu cầu'`, `'rate limit'`, `'slow down'`, `'try again in'` | 🎯 Xuất sắc: Có Regex trích xuất delay `try again in (\d+)\s*(s|sec|seconds)?` để ghi đè `recommendedDelayMs`. |
| 9 | `SERVER_ERROR_5XX` | `RETRYABLE` | `true` | lines 211–238 | `'500 internal server'`, `'502 bad gateway'`, `'503 service unavailable'`, `'504 gateway timeout'`, `'backend error'` | ✅ Phù hợp, delay 4000ms. |
| 10 | `NETWORK_TRANSIENT` | `RETRYABLE` | `true` | lines 240–266 | `'econnreset'`, `'etimedout'`, `'enotfound'`, `'econnrefused'`, `'fetch failed'`, `'err_internet_disconnected'`, `'net::err'` | ✅ Độ phủ mạng rất tốt, delay 3000ms. |
| 11 | `AGENT_TRANSIENT_ERROR` | `RETRYABLE` | `true` | lines 268–287 | `'tác nhân đã gặp lỗi'`, `'agent encountered an error'`, `'creative agent encountered an error'`, `'agent_error'` | ❌ **Xung đột kiến trúc với Adapter layer**: Classifier coi là RETRYABLE, nhưng `GoogleFlowImageAdapter.ts:118` và `GoogleFlowVideoAdapter.ts:112` lại coi là fatal stop. |
| 12 | `ELEMENT_TRANSIENT_BUSY` | `RETRYABLE` | `true` | lines 289–312 | `'quá thời gian chờ'`, `'timeout'`, `'wait_timeout'`, `'element_not_found'`, `'obscured'`, `'che phủ'` | ⚠️ **Quá tham lam (Greedy)**: Bắt cả chữ `'timeout'` tổng quát, dẫn đến timeout render của video/ảnh bị gán nhầm thành lỗi phần tử DOM. |
| 13 | `UNKNOWN_ERROR` | `RETRYABLE` | `true` | lines 314–324 | Mọi lỗi còn lại không khớp danh sách trên | ❌ **Nguy hiểm**: Mặc định cho phép `canRetry: true` đối với lỗi không xác định, dễ dẫn đến vòng lặp retry mù quáng. |

---

### 1.2. FlowRecoveryManager.ts: Cơ Chế Phục Hồi & Tác Vụ Chẩn Đoán

File: `main/workflow/flow-engine/FlowRecoveryManager.ts` (211 dòng).
Hệ thống định nghĩa `FlowRecoveryErrorType = 'ELEMENT_NOT_FOUND' | 'OVERLAY_BLOCKING' | 'SESSION_EXPIRED' | 'UNKNOWN_STATE'`.

1. **Overlay Healing (lines 48–81)**:
   - Sử dụng `FlowOverlayDetector.detect(win)` và `dismiss(win)`.
   - Cơ chế giải phóng 4 bước: gửi Escape OS -> click các nút đóng (`button[aria-label*="Close" i]`) -> click backdrop -> gửi Escape lần 2 (lines 170–227 của `FlowOverlayDetector.ts`).
   - Đánh giá: Hoạt động rất tốt với các dialog Angular Material CDK chuẩn.

2. **Element Missing Recovery (lines 86–120)**:
   - Kiểm tra xem phần tử bị thiếu có phải do overlay che không; nếu có thì đóng overlay và trả về `recovered: true`.
   - Nếu `pageState.state === 'LOGIN_PAGE' || pageState.state === 'ERROR_PAGE'`, trả về `shouldAbort: true`.

3. **Chẩn đoán UNKNOWN_STATE & Sự cố Offscreen Window (lines 140–208)**:
   ```ts
   // Trích xuất lines 167-195 FlowRecoveryManager.ts
   origPosition = win.getPosition();
   wasOffscreen = origPosition[0] < -1000 || origPosition[1] < -1000;
   if (wasOffscreen) {
     console.log(`[FlowRecoveryManager] [${ctx.taskId}] 🔄 Tạm thời flip cửa sổ về màn hình chính (100, 100) để cấp GPU paint buffer cho capturePage...`);
     win.setPosition(100, 100);
     win.showInactive();
     await new Promise((r) => setTimeout(r, 100));
   }
   const image = await win.webContents.capturePage();
   ...
   finally {
     if (wasOffscreen && origPosition && win && !win.isDestroyed()) {
       win.setPosition(origPosition[0], origPosition[1]);
     }
   }
   ```
   - **Vấn đề quan sát**: Cửa sổ bị dịch đột ngột về toạ độ `(100, 100)` trong 100ms trên màn hình người dùng, gây hiện tượng chớp giật giao diện (visual flash glitch).
   - **Đường dẫn lưu file (lines 144–154, 180)**:
     ```ts
     const scratchDir = path.join(process.cwd(), 'scratch');
     if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
     const filenameBase = `diagnostics_${ctx.taskId}_${Date.now()}`;
     domPath = path.join(scratchDir, `${filenameBase}.html`);
     screenshotPath = path.join(scratchDir, `${filenameBase}.png`);
     ```
   - Không có bất kỳ logic dọn dẹp (cleanup), giới hạn số file, hay kiểm tra TTL/dung lượng ổ đĩa. Kiểm tra thư mục `scratch/` thực tế cho thấy đã tồn tại 8 file diagnostics cũ (tổng dung lượng nhiều megabyte).
   - `process.cwd()` là thư mục gốc ứng dụng, sẽ bị lỗi `EACCES`/`EPERM` khi đóng gói (packaged app) vào `C:\Program Files\`.

---

### 1.3. FlowRetryManager.ts & Thuật Toán Backoff

File: `main/workflow/flow-engine/FlowRetryManager.ts` (155 dòng).
- **Cấu hình mặc định (lines 15–21)**:
  `maxRetries: 3`, `baseDelayMs: 2000`, `maxDelayMs: 15000`, `backoffFactor: 2.0`, `jitterRatio: 0.2` (+-20% Full Jitter).
- **Công thức tính toán (lines 40–65)**:
  `expDelay = baseDelayMs * Math.pow(backoffFactor, attempt - 1)`
  Nếu có `classified?.recommendedDelayMs > expDelay`, ưu tiên giá trị khuyến nghị.
  Giới hạn trần: `Math.min(maxDelayMs, expDelay)`.
  Full Jitter: `cappedDelay * (1 - jitterRatio + Math.random() * 2 * jitterRatio)`.
  Floor: `Math.max(500, finalDelay)`.
- **Hàm `waitDelay` (lines 143–153)**: Chia nhỏ delay thành các nhịp 200ms và kiểm tra `ctx.isCancelled?.()`, giúp phản hồi ngay khi huỷ tác vụ.

---

### 1.4. Idempotency Jump & Kiểm Tra Trùng Lặp Tạo Tác Vụ

1. **Cơ chế Idempotency Jump trong `FlowRetryManager.ts` (lines 113–126)**:
   ```ts
   if (stateName === 'CLICK_GENERATE' || stateName === 'VERIFY_GENERATION_STARTED') {
     if (ctx.generateClickedAt > 0 || ctx.generationState === 'STARTING' || ctx.generationState === 'GENERATING') {
       console.warn(`[FlowRetryManager] [${ctx.taskId}] ⚠️ IDEMPOTENCY GUARD TRONG RETRY: State [${stateName}] thất bại nhưng generation có thể đã khởi động... Chuyển hướng sang WAIT_FOR_GENERATION thay vì click lại!`);
       return {
         shouldRetry: true,
         attempt: attempt + 1,
         delayMs: 1500,
         skipToState: 'WAIT_FOR_GENERATION',
         reason: 'Bỏ qua click trùng lặp, chuyển sang chờ kết quả theo quy tắc Idempotency',
       };
     }
   }
   ```

2. **Cơ chế Tiền Kiểm Tra Idempotency (State 13 trong `FlowImageGenerationStates.ts:932–1031`)**:
   `CheckIdempotencyBeforeGenerateState`: Quét DOM xem prompt đã bị xóa chưa (`isCleared`), có spinner không (`hasSpinner`), nút generate có bị disabled không (`btnDisabled`), và có card đang sinh không (`hasGeneratingCard`). Nếu có, trả về `skipToState: 'WAIT_FOR_GENERATION'` ngay trước khi đến State 14 (`CLICK_GENERATE`).

3. **LỖ HỔNG CRITICAL 1: Timing Gap trong `ClickGenerateState` (`FlowImageGenerationStates.ts:1043–1178`)**:
   - Dòng 1096: `target.click()` được thực thi trên DOM.
   - Dòng 1121–1133: Tiếp tục adaptive polling toạ độ fresh.
   - Dòng 1155–1169: Gửi click chuột native `sendInputEvent`.
   - Dòng 1175: Mới gán `ctx.generateClickedAt = Date.now()`.
   - **Hậu quả**: Nếu sau khi `target.click()` (dòng 1096) chạy xong, Chromium gặp trục trặc toạ độ hoặc timeout ở dòng 1121–1133 khiến hàm quăng ngoại lệ, `ctx.generateClickedAt` vẫn bằng `0` và `ctx.generationState` vẫn là `'READY'`. Khi rơi vào `FlowRetryManager.evaluate()`, điều kiện dòng 114 **KHÔNG THỎA MÃN**! Kết quả: hệ thống retry lại `CLICK_GENERATE`, gửi click lần thứ 2 gây duplicate generation!

4. **LỖ HỔNG CRITICAL 2: Tác Vụ Video Hoàn Toàn Thiếu Idempotency Guard**:
   - File `main/workflow/dispatcher/adapters/GoogleFlowVideoAdapter.ts` gọi `sessionMgr.generateVideoViaBrowserContext` (lines 72–88).
   - Kiểm tra `GoogleVeoSessionManager.ts:1393–2158`: Hàm này dài hơn 760 dòng, chạy script tuần tự thô sơ, **KHÔNG SỬ DỤNG** `FlowStateMachine`, **KHÔNG CÓ** `CheckIdempotencyBeforeGenerateState`, **KHÔNG CÓ** `FlowRetryManager`.
   - Khi gặp timeout (sau 240 giây chờ Veo render), `generateVideoViaBrowserContext` trả về `null` (line 2152).
   - Trong `GoogleFlowVideoAdapter.ts:140–149`:
     ```ts
     const errorType = result?.error || 'video_generation_timeout';
     if (retryCount < this.maxInternalRetries) {
       retryCount++;
       ...
       continue; // GỌI LẠI TOÀN BỘ generateVideoViaBrowserContext TỪ ĐẦU!
     }
     ```
   - **Hậu quả thảm họa**: Khi Veo render chậm quá 240s, Adapter tự động retry, nhập lại prompt và **BẤM NÚT TẠO VIDEO LẦN THỨ 2**, trừ thêm một lượng lớn credit Veo đắt đỏ và tạo ra 2 video trùng lặp!

---

### 1.5. Xung Đột Luồng Điều Phối (Multi-Tier Retry & Lock Inconsistency)

1. **Hiện tượng Retry Đa Tầng (Multi-Tier Retry Multiplication)**:
   - Tầng trong: `FlowStateMachine.ts:222` thực hiện retry tối đa 3 lần cho mỗi state.
   - Tầng ngoài: `GoogleFlowImageAdapter.ts:61` thực hiện retry `while (retryCount <= maxInternalRetries)` (2 lần).
   - Tổng số lượt thử tối đa: `(1 + 3) * (1 + 2) = 12` lần lặp cho cùng một node hình ảnh.

2. **Phân Mảnh Cơ Chế Khoá Trình Duyệt (3 Bộ Serializer Chạy Song Song)**:
   - `GoogleFlowBrowserMutex.ts`: Sử dụng `AsyncLocalStorage`, re-entrant, dùng trong `GoogleFlowImageAdapter` và `GoogleFlowVideoAdapter`.
   - `GoogleVeoAntiSpamGuard.ts`: Sử dụng queue mảng tĩnh, cờ `isGenerating`, dùng trong `GoogleFlowAdapter.ts` (Phase 1–3).
   - `OnlineImageRateLimiter` (`GoogleFlowAdapter.ts:34–59`): Sử dụng chuỗi Promise nội bộ với delay 2500ms.
   - **Rủi ro**: Nếu luồng cũ (`GoogleFlowAdapter`) và luồng mới (`GoogleFlowImageAdapter`) cùng chạy, chúng không dùng chung lock, dẫn đến việc 2 tác vụ cùng can thiệp vào một `lobbyWindow` duy nhất!

---

## 2. LOGIC CHAIN (Chuỗi Suy Luận Từ Quan Sát Đến Kết Luận)

```
[Observation 1.2: FlowStateMachine.ts lines 162-188]
Bắt stateErr -> Đoán errType qua substring thô sơ -> Gọi FlowRecoveryManager.handleRecovery
        │
        ▼
[Logic Step 1: Inverted Error Handling Hierarchy]
Khi gặp lỗi mạng (ví dụ 'read ECONNRESET at TLSWrap.onStreamRead'):
- Chuỗi không chứa 'obscured', 'not found', hay 'session'.
- errType bị gán là 'UNKNOWN_STATE'.
- FlowRecoveryManager lập tức chụp ảnh màn hình và dump HTML DOM vào scratch/.
- Sau đó mới gọi FlowErrorClassifier (Level 2) và nhận diện ra NETWORK_TRANSIENT.
- Tiếp theo FlowRetryManager (Level 3) kích hoạt Idempotency Jump thành công.
==> KẾT LUẬN: Thứ tự phân tầng bị đảo lộn. State Machine thực hiện chẩn đoán nặng nề (dump DOM, chụp màn hình) trước khi phân loại lỗi, sinh ra hàng loạt file rác dù lỗi có thể tự phục hồi bằng retry mạng.
```

```
[Observation 1.4 & Code ClickGenerateState: 1096, 1175]
target.click() chạy ở dòng 1096 -> Timeout toạ độ ở 1121 -> ctx.generateClickedAt vẫn = 0
        │
        ▼
[Logic Step 2: Idempotency Blind Spot on Fast Failure]
Nếu DOM click đã gửi yêu cầu tới server Google Flow nhưng Chromium bị treo/timeout trong bước tính toạ độ chuột native:
- Ngoại lệ bị quăng ra trước dòng 1175.
- generateClickedAt = 0, generationState = 'READY'.
- FlowRetryManager.evaluate kiểm tra: (generateClickedAt > 0 || state === 'STARTING') => FALSE.
- Retry Manager không kích hoạt Idempotency Jump mà trả về shouldRetry = true, thực thi lại CLICK_GENERATE.
==> KẾT LUẬN: Nguy cơ sinh trùng lặp (duplicate generation) và tiêu tốn gấp đôi quota tín dụng khi xảy ra lỗi gián đoạn ngay giữa click DOM và click native.
```

```
[Observation 1.4 & GoogleFlowVideoAdapter.ts: 72-149, GoogleVeoSessionManager.ts: 1393-2158]
Video hoàn toàn không dùng FlowStateMachine, retry bằng vòng lặp while gọi lại toàn bộ hàm
        │
        ▼
[Logic Step 3: Complete Absence of Video Resilience]
- Trong khi Image Engine đã được nâng cấp lên 18 states với Verify-After-Action và Idempotency Guard ở Phase 6.
- Video Engine vẫn là mã kịch bản nguyên khối thừa kế từ Phase 2-3.
- Khi thời gian sinh video vượt quá 240 giây (rất phổ biến khi Veo cao tải), Adapter quăng lỗi timeout và kích hoạt retry toàn phần.
- Lần retry thứ 2 tiếp tục bấm nút Tạo Video mà không hề kiểm tra xem video trước đó có đang được render trên canvas hay không.
==> KẾT LUẬN: Video Engine là vùng rủi ro tài nguyên cao nhất của ứng dụng hiện tại, vi phạm nghiêm trọng nguyên tắc an toàn hạn mức tín dụng.
```

```
[Observation 1.2: scratchDir = path.join(process.cwd(), 'scratch')]
File DOM snapshot (.html) và screenshot (.png) ghi trực tiếp vào process.cwd()/scratch
        │
        ▼
[Logic Step 4: Storage Leak and Production Packaging Crash]
- Mỗi file HTML DOM của Google Flow nặng từ 1MB đến 4MB.
- Mỗi ảnh chụp màn hình PNG nặng từ 1.5MB đến 5MB.
- Không có bất kỳ cron dọn dẹp, không giới hạn dung lượng tối đa, không có TTL.
- Trên môi trường production đóng gói Windows (NSIS Installer), ứng dụng chạy từ `C:\Program Files\vanhsub\`. Thư mục này là Read-Only đối với tiến trình người dùng thông thường.
- Lệnh fs.mkdirSync(scratchDir) sẽ ném lỗi EPERM / EACCES, làm crash toàn bộ tiến trình chẩn đoán lỗi.
==> KẾT LUẬN: Cơ chế lưu trữ chẩn đoán hiện tại vi phạm chuẩn phát triển Electron và gây nguy cơ rò rỉ đĩa cứng / crash ứng dụng.
```

---

## 3. CAVEATS (Vùng Giới Hạn, Giả Định & Các Yếu Tố Chưa Khảo Sát)

1. **Hạn chế môi trường Audit Read-Only**: Chuyên viên không trực tiếp khởi chạy lệnh tạo video Veo thật để tránh tiêu tốn credit tài khoản của người dùng. Các kết luận về timing gap và duplicate click được chứng minh bằng phân tích cú pháp tĩnh và đối chiếu với log kiểm chứng có sẵn trong `scratch/run_phase6_idempotency_live.ts`.
2. **Biến động DOM phía Google**: Google Flow thường xuyên cập nhật giao diện Angular (thay đổi tên thẻ từ `flow-generate-icon-button` sang thẻ custom mới). Logic phân loại lỗi bằng regex chuỗi tiếng Việt/Anh (`FlowErrorClassifier.ts`) phụ thuộc vào ngôn ngữ hiển thị của tài khoản Google; nếu tài khoản hiển thị tiếng Pháp, Nhật hoặc ngôn ngữ khác, các regex chuỗi có thể không bắt được.
3. **Chưa khảo sát IPC Renderer**: Nhánh kiểm toán này tập trung vào Main Process (`flow-engine`, `dispatcher`, `veo`); cách Renderer UI hiển thị lỗi cho người dùng cuối thuộc phạm vi của Lead Agent (Track 4).

---

## 4. CONCLUSION (Đánh Giá Toàn Diện & Khuyến Nghị Khắc Phục)

### 4.1. Bảng Tổng Kết Đánh Giá Kiến Trúc

| Thành Phần | Hiện Trạng | Mức Độ Hoàn Thiện | Đánh Giá & Rủi Ro |
|---|---|---|---|
| **FlowErrorClassifier** | Đã phân loại 13 mã lỗi, có 3 nhóm Category rõ ràng, trích xuất được Retry-After cho HTTP 429. | 🟡 Khá (75%) | Còn phụ thuộc nhiều vào so khớp chuỗi con tiếng Việt; xung đột định nghĩa `AGENT_TRANSIENT_ERROR` với Adapter; mặc định cho retry `UNKNOWN_ERROR`. |
| **FlowRecoveryManager** | Đã có tự động đóng Overlay 4 bước, phát hiện màn che CDK, chụp DOM snapshot và screenshot offscreen. | 🟡 Khá (70%) | Bị gọi sai vị trí trong State Machine; thiếu action reload trang và re-auth; cơ chế flip offscreen gây chớp màn hình; lưu file vào `process.cwd()/scratch` gây rò rỉ đĩa. |
| **FlowRetryManager** | Thuật toán Exponential Backoff + Full Jitter đạt chuẩn hệ phân tán; có Idempotency Jump bỏ qua click trùng. | 🟢 Tốt (85%) | Cần chuẩn hoá giao tiếp với State Machine để không bị lặp lại đa tầng ở Adapter layer. |
| **Idempotency Guard (Image)** | Đã có State 13 tiền kiểm tra và State Machine jump sau click. | 🟡 Khá (70%) | Có kẽ hở thời gian (timing gap) ở State 14: nếu lỗi sau `target.click()` nhưng trước khi set timestamp, bảo vệ mất tác dụng. |
| **Idempotency Guard (Video)** | Chưa có State Machine cho Video, hoàn toàn thiếu Idempotency Guard. | 🔴 Kém (15%) | Điểm yếu chí mạng nhất của hệ thống, nguy cơ sinh video trùng lặp và lãng phí credit rất cao. |
| **Quản Lý Concurrency / Lock** | Tồn tại đồng thời `GoogleFlowBrowserMutex`, `GoogleVeoAntiSpamGuard`, và `OnlineImageRateLimiter`. | 🔴 Kém (40%) | Rủi ro race condition nếu gọi chéo giữa các adapter cũ và mới. |

---

### 4.2. Khuyến Nghị Refactor Cụ Thể (Actionable Proposals)

#### Khuyến Nghị 1: Đảo Ngược Thứ Tự Phân Tầng Lỗi trong `FlowStateMachine.ts`
Chuyển `FlowErrorClassifier` lên vị trí số 1 ngay khi bắt ngoại lệ. Chỉ kích hoạt `FlowRecoveryManager` khi lỗi được xác định là sự cố DOM (`ELEMENT_TRANSIENT_BUSY` hoặc `UNKNOWN_ERROR`). Nếu là lỗi mạng (`NETWORK_TRANSIENT`, `RATE_LIMIT_429`), bỏ qua hoàn toàn bước chụp màn hình/dump DOM để giữ sạch thư mục lưu trữ.

```
Mô hình hiện tại (Lỗi):
stateErr ➔ Recovery (chụp ảnh + dump DOM rác) ➔ Classifier ➔ Retry

Mô hình đề xuất chuẩn:
stateErr ➔ FlowErrorClassifier.classify()
              ├─ Lỗi Fatal / Auth (SESSION_EXPIRED, OUT_OF_CREDITS, USER_CANCELLED) ➔ Abort ngay
              ├─ Lỗi Mạng / Server (NETWORK_TRANSIENT, RATE_LIMIT_429) ➔ Bỏ qua DOM Healing ➔ FlowRetryManager.evaluate()
              └─ Lỗi DOM (ELEMENT_TRANSIENT_BUSY, UNKNOWN) ➔ FlowRecoveryManager (Healing/Dismiss Overlay) ➔ Nếu hết cách mới Dump Diagnostic Snapshot ➔ Abort
```

#### Khuyến Nghị 2: Khắc Phục Timing Gap trong `ClickGenerateState`
Trong `FlowImageGenerationStates.ts`, đánh dấu cờ `ctx.generationState = 'STARTING'` và gán `ctx.generateClickedAt = Date.now()` **NGAY TRƯỚC** khi dispatch bất kỳ lệnh click nào (`target.click()` hoặc `sendInputEvent`). Nếu sau đó có ngoại lệ xảy ra, `FlowRetryManager` luôn nhận diện được cờ và kích hoạt Idempotency Jump sang `WAIT_FOR_GENERATION`.

#### Khuyến Nghị 3: Di Chuyển Video Engine lên `FlowStateMachine` (Phase 7 Priority)
Tạo `FlowVideoGenerationStatePipeline` tương tự như Image Pipeline (bao gồm `CheckIdempotencyBeforeGenerateState` cho video). Loại bỏ hàm monolithic 760 dòng trong `GoogleVeoSessionManager.ts`.

#### Khuyến Nghị 4: Chuẩn Hoá Thư Mục Lưu Trữ Diagnostic Artifacts & Quản Lý TTL
- Chuyển đường dẫn lưu file từ `path.join(process.cwd(), 'scratch')` sang `path.join(app.getPath('userData'), 'diagnostics')`.
- Bổ sung cơ chế tự động xoá file cũ (TTL 7 ngày hoặc tối đa 50MB, giữ lại tối đa 20 file gần nhất).

#### Khuyến Nghị 5: Hợp Nhất Mutex Lock Toàn Ứng Dụng
Xoá bỏ `OnlineImageRateLimiter` và hợp nhất `GoogleVeoAntiSpamGuard` vào `GoogleFlowBrowserMutex`. Tất cả các thao tác liên quan tới Sảnh Google Flow (Image, Video, Canvas Clean, Settings) bắt buộc phải đi qua duy nhất một Singleton `GoogleFlowBrowserMutex.getInstance().runExclusive()`.

---

## 5. VERIFICATION METHOD (Phương Pháp Độc Lập Kiểm Chứng)

Để kiểm chứng độc lập các phát hiện trong báo cáo mà không cần thay đổi source code:

1. **Kiểm chứng Thứ tự Phân tầng & Dump Rác**:
   - Mở file `main/workflow/flow-engine/FlowStateMachine.ts`.
   - Quan sát từ dòng 161 đến 195: Khối `catch (stateErr)` gọi `FlowRecoveryManager.handleRecovery` ở dòng 177 TRƯỚC KHI gọi `FlowErrorClassifier.classify` ở dòng 188.
   - Quan sát dòng 163–170: Chuỗi lỗi mạng không khớp 3 điều kiện `obscured`, `not found`, `session`, nên biến `errType` nhận giá trị `'UNKNOWN_STATE'`.
   - Đối chiếu file log thực tế trong `scratch/`: `diagnostics_task_p6_idempotency_live_1789544327530_1789544335947.html` và `.png` được sinh ra chính từ kịch bản test ném lỗi mạng `ECONNRESET` tại `scratch/run_phase6_idempotency_live.ts:47`.

2. **Kiểm chứng Timing Gap gây mất Idempotency**:
   - Mở file `main/workflow/flow-engine/states/FlowImageGenerationStates.ts`.
   - Kiểm tra dòng 1096: `target.click()` được gọi bên trong JS DOM context.
   - Kiểm tra dòng 1121–1140: Vòng lặp `FlowSmartWait.pollUntil` lấy toạ độ thực thi sau đó.
   - Kiểm tra dòng 1175: Biến `ctx.generateClickedAt = Date.now()` mới được gán. Nếu có lỗi ở dòng 1138, dòng 1175 không bao giờ được thực thi.
   - Mở file `main/workflow/flow-engine/FlowRetryManager.ts:114`: Biến `ctx.generateClickedAt > 0` là điều kiện tiên quyết để kích hoạt Idempotency Jump. Khi biến này bằng 0, hệ thống không nhảy cóc mà retry click.

3. **Kiểm chứng Lỗ Hổng Retry của Video Engine**:
   - Mở file `main/workflow/dispatcher/adapters/GoogleFlowVideoAdapter.ts:70–150`.
   - Quan sát dòng 72: Gọi `sessionMgr.generateVideoViaBrowserContext`.
   - Quan sát dòng 140–149: Khi kết quả trả về `error = 'video_generation_timeout'`, vòng lặp `while (retryCount <= maxInternalRetries)` thực hiện gọi lại toàn bộ hàm `generateVideoViaBrowserContext`.
   - Mở `main/veo/GoogleVeoSessionManager.ts:1393`: Hàm này không kiểm tra xem trên canvas đã có video đang render từ lượt trước hay chưa, mà thực hiện điền lại prompt và click nút tạo video lần thứ 2 ở dòng 1905.

4. **Kiểm chứng Rủi Ro Ghi Đĩa & Phân Vùng Ứng Dụng**:
   - Mở file `main/workflow/flow-engine/FlowRecoveryManager.ts:144`.
   - Xác minh câu lệnh: `const scratchDir = path.join(process.cwd(), 'scratch');`.
   - Chạy lệnh kiểm tra thư mục hiện tại: Trong môi trường cài đặt thực tế của Electron (`C:\Program Files\...`), `process.cwd()` không có quyền ghi nếu không có đặc quyền UAC Admin.
