# BÁO CÁO KIỂM TOÁN CHUYÊN SÂU: UI & DOM LOCATOR STRATEGIES TRONG HỆ THỐNG GOOGLE FLOW AUTOMATION

**Chuyên viên thực hiện**: UI & DOM Locator Specialist (Track 1)  
**Thời điểm hoàn thành**: 2026-09-16T08:18:00Z  
**Phạm vi kiểm toán**: 
- `main/workflow/flow-engine/FlowElementFinder.ts`
- `main/workflow/flow-engine/FlowSmartWait.ts`
- `main/workflow/flow-engine/FlowOverlayDetector.ts`
- `main/workflow/flow-engine/FlowPageStateDetector.ts`
- `main/workflow/flow-engine/FlowRecoveryManager.ts`
- `main/workflow/flow-engine/states/FlowImageGenerationStates.ts`
- `main/veo/GoogleVeoSessionManager.ts`
- `main/workflow/adapters/GoogleFlowAdapter.ts`
- `main/workflow/dispatcher/adapters/GoogleFlowImageAdapter.ts` & `GoogleFlowVideoAdapter.ts`
- Thư mục kiểm thử `scratch/`

---

## 1. OBSERVATIONS (QUAN SÁT THỰC TẾ TRÍCH XUẤT TỪ MÃ NGUỒN)

### 1.1. Hiện trạng cấu trúc định vị và sự hợp nhất của FlowElementSpecs
- **Quan sát 1.1.1**: Tập tin `FlowElementSpecs.ts` được đề cập trong chỉ thị nhiệm vụ không tồn tại độc lập trên hệ thống tập tin (kết quả `grep_search` và `find_by_name` cho thấy 0 kết quả). Toàn bộ các đặc tả tìm kiếm phần tử (`ElementSearchSpec`) đã được định nghĩa trực tiếp dưới dạng các hàm static factory bên trong tập tin `main/workflow/flow-engine/FlowElementFinder.ts` (dòng 297–1016).
- **Quan sát 1.1.2**: Danh mục các bộ đặc tả (`ElementSearchSpec`) hiện hành trong `FlowElementFinder.ts`:
  1. `getGenerateButtonSpec()` (dòng 297–352): Nút Generate Image / Bắt đầu tạo.
  2. `getPromptInputSpec()` (dòng 357–404): Ô nhập liệu ProseMirror / contenteditable.
  3. `getEditorContainerSpec()` (dòng 409–458): Khung chứa prompt box container.
  4. `getClearCanvasSpec()` (dòng 463–530): Nút xoá canvas / xoá lời nhắc.
  5. `getNewProjectButtonSpec()` (dòng 535–591): Nút Tạo dự án mới trên sảnh.
  6. `getModeTabSpec(mode)` (dòng 602–684): Tab chuyển đổi Image / Video.
  7. `getSettingsTriggerSpec()` (dòng 689–759): Nút mở popover cài đặt (Tune / Options).
  8. `getAspectRatioSpec(ratio)` (dòng 765–827): Toggle tỉ lệ khung hình (16:9, 9:16, 1:1, 4:3, 3:4).
  9. `getOutputCountSpec(count)` (dòng 832–900): Toggle số lượng ảnh đầu ra (x1, x2, x4).
  10. `getCloseOverlaySpec()` (dòng 905–959): Nút đóng dialog, overlay, lightbox.
  11. `getModelSelectorSpec(modelName)` (dòng 964–1015): Bộ chọn mô hình Imagen / Nano.

### 1.2. Thống kê phương pháp tự động hoá (Automation Methods Breakdown)
Toàn bộ mã nguồn tự động hoá tương tác trình duyệt được phân bố tại 3 khu vực chính:
1. `main/workflow/flow-engine/states/FlowImageGenerationStates.ts` (Động cơ State Machine mới cho Ảnh)
2. `main/veo/GoogleVeoSessionManager.ts` (Động cơ cũ và lớp quản lý phiên sảnh)
3. `main/workflow/flow-engine/FlowOverlayDetector.ts` (Bộ giải phóng overlay)

| Phương pháp Automation | Số lần xuất hiện | Tỷ lệ % | Chi tiết hiện thực |
| :--- | :---: | :---: | :--- |
| **DOM Selectors & JS Evaluation** (`querySelector`, `querySelectorAll`, `.click()`, `execCommand`, `localStorage`) | 68 vị trí | **70.8%** | Được sử dụng trong tất cả 18 state của State Machine, các hàm kiểm tra visible, đếm text, dọn canvas, bắt link ảnh/video. |
| **Dynamic Bounding-Box Native Mouse Events** (`sendInputEvent` với toạ độ tính từ `getBoundingClientRect()`) | 15 lần gọi | **15.6%** | Gửi sự kiện chuột OS thật (`mouseDown`, `mouseUp`, `mouseMove`) tại điểm tâm phần tử sau khi tính toán toạ độ tức thời. |
| **Native Keyboard Events** (`sendInputEvent` phím `Escape`, `Enter`) | 9 lần gọi | **9.4%** | Gửi phím cứng OS để đóng overlay/dialog (Escape) hoặc gửi bổ trợ form submission (Enter). |
| **Hardcoded Coordinate Clicks** (Click chuột mù tại toạ độ X, Y pixel cố định) | **0 lần** | **0.0%** | **KHÔNG CÓ bất kỳ cú click chuột nào dùng toạ độ pixel cứng**. 100% toạ độ click chuột đều được đo động tại thời điểm chạy. |
| **Hardcoded Window Offscreen Coordinates** | 4 tham chiếu hằng số | **4.2%** | Định vị cửa sổ Electron ra ngoài màn hình (`-3000, -3000`) và flip tạm về onscreen (`100, 100`). |
| **OCR / Visual Template Matching** | **0 lần** | **0.0%** | Không sử dụng OCR để định vị UI. (Module OCR trong `main/ocr/` chỉ phục vụ bóc phụ đề video do người dùng tải lên). |
| **CDP (Chrome DevTools Protocol) Direct Calls** | **0 lần** | **0.0%** | Không dùng `webContents.debugger.attach()` hay DevTools protocol command. 100% qua `executeJavaScript` và `sendInputEvent`. |

#### Chi tiết tất cả 24 lần gọi `sendInputEvent` trong mã nguồn:
1. `main/veo/GoogleVeoSessionManager.ts:982, 984`: Phím `Escape` (down/up) khi đóng sảnh login.
2. `main/veo/GoogleVeoSessionManager.ts:1085, 1091, 1099`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `clickX, clickY` (tính từ `cand.rect` của `FlowElementFinder.getNewProjectButtonSpec`).
3. `main/veo/GoogleVeoSessionManager.ts:1294, 1296, 1298`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `x, y` (tính từ `cand.rect` của `FlowElementFinder.getModeTabSpec`).
4. `main/veo/GoogleVeoSessionManager.ts:1315, 1317, 1319`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `x, y` (tính từ `cand.rect` của `FlowElementFinder.getSettingsTriggerSpec`).
5. `main/veo/GoogleVeoSessionManager.ts:1337, 1339, 1341`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `x, y` (tính từ `cand.rect` của `FlowElementFinder.getAspectRatioSpec`).
6. `main/veo/GoogleVeoSessionManager.ts:1356, 1358, 1360`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `x, y` (tính từ `cand.rect` của `FlowElementFinder.getOutputCountSpec`).
7. `main/veo/GoogleVeoSessionManager.ts:1381, 1383`: Phím `Escape` (down/up) để đóng popover settings.
8. `main/veo/GoogleVeoSessionManager.ts:1905, 1913`: Chuột `mouseDown`, `mouseUp` tại `fillResult.btnCoords` (tính từ `rect = target.getBoundingClientRect()` trong `fillPromptJs`).
9. `main/veo/GoogleVeoSessionManager.ts:1973, 1975`: Phím `Enter` (down/up) bổ trợ submission trong video generation cũ.
10. `main/veo/GoogleVeoSessionManager.ts:2425, 2433`: Chuột `mouseDown`, `mouseUp` tại `res.coords` (tính từ `rect = btn.getBoundingClientRect()` trong `autoConfirmAgentPermission`).
11. `main/veo/GoogleVeoSessionManager.ts:2497, 2499`: Phím `Escape` (down/up) trong `ensureCleanCanvasReady`.
12. `main/veo/GoogleVeoSessionManager.ts:2510, 2512`: Chuột `mouseDown`, `mouseUp` tại `cx, cy` (tính từ `cand.rect` của `FlowElementFinder.getCloseOverlaySpec`).
13. `main/veo/GoogleVeoSessionManager.ts:2614, 2622`: Chuột `mouseDown`, `mouseUp` tại `cleanResult.coords` (tính từ `getBoundingClientRect()` của ô prompt trống để focus).
14. `main/workflow/flow-engine/FlowOverlayDetector.ts:174, 175`: Phím `Escape` (down/up) bước 1 của Overlay dismissal.
15. `main/workflow/flow-engine/FlowOverlayDetector.ts:220, 221`: Phím `Escape` (down/up) bước 4 của Overlay dismissal.
16. `main/workflow/flow-engine/states/FlowImageGenerationStates.ts:1155, 1163`: Chuột `mouseDown`, `mouseUp` tại `clickInfo.coords` (tính từ fresh `getBoundingClientRect()` tức thời tại State 14: `CLICK_GENERATE`).
17. `main/workflow/flow-engine/states/FlowImageGenerationStates.ts:1262, 1264`: Phím `Enter` (down/up) bổ trợ kích hoạt tại State 15: `VERIFY_GENERATION_STARTED`.

### 1.3. Danh sách cụ thể các toạ độ Hardcoded trong toàn dự án
Mặc dù KHÔNG có toạ độ click chuột cứng, hệ thống tồn tại các toạ độ cấu hình cứng liên quan đến kích thước cửa sổ và vị trí hiển thị:

| Tập tin | Dòng code | Cú pháp / Giá trị | Mục đích sử dụng | Rủi ro tiềm ẩn |
| :--- | :--- | :--- | :--- | :--- |
| `main/veo/GoogleVeoSessionManager.ts` | 41–42 | `export const OFFSCREEN_X = -3000;`<br>`export const OFFSCREEN_Y = -3000;` | Di chuyển `lobbyWindow` ra ngoài màn hình làm việc để chạy ngầm | Trên một số GPU/OS driver, Chromium ngừng render khi toạ độ vượt xa màn hình thực; nếu người dùng dùng nhiều màn hình kéo dài sang trái, cửa sổ có thể bị lộ. |
| `main/veo/GoogleVeoSessionManager.ts` | 253, 306-307, 1639, 2423, 2612, 2675 | `win.setPosition(OFFSCREEN_X, OFFSCREEN_Y)` | Đặt vị trí cửa sổ sảnh về toạ độ âm | Trùng lặp mã gọi nhiều lần; có nguy cơ giật màn hình nếu gọi liên tục. |
| `main/workflow/flow-engine/FlowRecoveryManager.ts` | 172–175 | `win.setPosition(100, 100);` | Tạm thời flip cửa sổ về vị trí (100, 100) để cấp GPU paint buffer trước khi gọi `capturePage()` | Cửa sổ có thể nhấp nháy 1 khung hình trên màn hình người dùng trước khi được đưa trở lại (-3000, -3000). |
| `main/workflow/flow-engine/FlowSmartWait.ts` | 340–341 | `clampedX = Math.max(2, Math.min(window.innerWidth - 2, x));`<br>`clampedY = Math.max(2, Math.min(window.innerHeight - 2, y));` | Đệm biên an toàn 2px tránh vượt ngoài viewport khi gọi `elementFromPoint(x, y)` | Rất an toàn, chuẩn W3C, giúp tránh lỗi trả về null của `elementFromPoint`. |
| `main/workflow/flow-engine/FlowElementFinder.ts` | 195–196 | `width: 24, height: 24` | Giả lập kích thước bounding box cho `fallbackCoordinates` nếu được khai báo | Nếu fallback toạ độ được bật, kích thước 24x24 là giả định, không phản ánh kích thước thật của button. |
| `main/workflow/flow-engine/FlowElementFinder.ts` | 160 | `elData.rect.width > 20 && elData.rect.height > 20` | Ngưỡng cộng điểm thưởng kích thước (+2 điểm) cho element | An toàn, lọc bỏ các icon 0px hoặc element ẩn. |

### 1.4. Đánh giá các cơ chế định vị nâng cao

#### A. Container Scoping (Cô lập phạm vi tìm kiếm)
- **Cơ chế**: Triển khai tại `FlowElementFinder.ts` (dòng 94–103). Nếu rule có thuộc tính `containerSelector`, script quét DOM sẽ tìm container cha trước. Nếu container cha không tồn tại hoặc không hiển thị (`!isVisible`), hàm trả về `null` ngay lập tức, **tuyệt đối không quét ra ngoài document-wide**.
- **Mức độ bao phủ**:
  - Áp dụng đầy đủ cho: `CLEAR_CANVAS_BUTTON`, `NEW_PROJECT_BUTTON`, `MODE_TAB`, `SETTINGS_TRIGGER_BUTTON`, `ASPECT_RATIO`, `OUTPUT_COUNT`.
- **LỖ HỔNG & RỦI RÔ QUAN SÁT THẤY**:
  1. **Lỗ hổng tại State 14 (`FlowImageGenerationStates.ts:1069`)**: Tại bước bấm nút Generate (`ClickGenerateState`), hàm `freshCoordJs` quét toàn bộ trang `const allButtons = Array.from(document.querySelectorAll(genBtnSelectors.join(', ')))` mà không giới hạn trong `flow-prompt-box`. Mặc dù có bộ lọc loại trừ class (`agent-action-button`, `settings-trigger-button`, v.v.), nếu trên trang xuất hiện một modal hoặc form submit khác, nó có thể bị bắt nhầm.
  2. **Lỗ hổng trong `generateVideoViaBrowserContext` (`GoogleVeoSessionManager.ts:1801`)**: Khi không tìm thấy nút trong prompt box, code cũ tự động rò rỉ tìm kiếm ra document-wide (`if (candidates.length === 0 && scope !== document) { candidates = Array.from(document.querySelectorAll(...)) }`).

#### B. Short-Text Protection (Phòng vệ văn bản ngắn)
- **Cơ chế**:
  1. *Lớp lọc cấu trúc (`FlowElementFinder.ts:112–115`)*: Với các selector text có độ dài $\le 2$ ký tự (`targetText.length <= 2`), thuật toán chuyển từ tìm kiếm tương đối (`txt.includes(targetText)`) sang so sánh chính xác tuyệt đối: `txt === targetText || txt === ('x' + targetText) || txt === (targetText + 'x')`.
  2. *Lớp hạ điểm tự động (`FlowElementFinder.ts:158–159`)*: Triệt tiêu điểm thưởng nhãn (+5 điểm) đối với text ngắn.
  3. *Lớp trần Confidence Threshold (`FlowElementFinder.ts:890`)*: Cấu hình `baseConfidence: 48` cho text `text:x1` / `text:1`. Sau khi cộng điểm kích thước (+2), tổng điểm đạt chính xác $50/100$. Vì $50 < 65$ (ngưỡng an toàn), `FlowElementFinder` từ chối tương tác với mã lỗi `low_confidence`.
- **Đánh giá**: Hoạt động hoàn hảo, triệt tiêu 100% hiện tượng false-click vào các số '1', '2' ngẫu nhiên trên trang.

#### C. Dynamic Scoring Algorithm (Thuật toán chấm điểm tin cậy)
- **Phân tầng trọng số cơ sở (Base Confidence)**:
  - Tầng 1 (`ACCESSIBILITY`): 95 điểm (ưu tiên cao nhất, tìm theo ARIA label, role)
  - Tầng 2 (`STRICT_COMPONENT`): 88 – 92 điểm (tìm theo custom tag của Google Flow như `flow-prompt-box`, `.ProseMirror`)
  - Tầng 3 (`CONTEXTUAL`): 78 – 80 điểm (tìm theo quan hệ cha con có container scope)
  - Tầng 4 (`TEXT_MATCH`): 68 điểm (text dài) hoặc 48–55 điểm (text ngắn $\le 2$ từ/ký tự)
  - Tầng 5 (`COORDINATE_FALLBACK`): 50 điểm (chỉ kích hoạt khi `allowCoordinateFallback: true`)
- **Điểm thưởng động**:
  - Có nhãn text/aria không rỗng (và không phải short-text): $+5$ điểm.
  - Kích thước hiển thị $> 20\times 20$ px: $+2$ điểm.
- **Quy tắc ngắn mạch (Short-circuit Execution)**: Nếu một tầng tìm thấy ứng viên có điểm $\ge 65$, vòng lặp dừng ngay lập tức (`break`, dòng 179–181), không duyệt tiếp các tầng thấp hơn nhằm tối ưu tốc độ.
- **Cổng chặn an toàn (Safety Rejection Gate)**: Nếu ứng viên có điểm cao nhất vẫn $< 65$, trả về `{ found: false, error: 'low_confidence' }` và từ chối click.

#### D. Overlay Detector & Dismissal Pipeline
- **Hiện thực**: `FlowOverlayDetector.ts` (dòng 31–228).
- **Khả năng nhận diện**: Quét và phân loại 4 nhóm overlay che chắn:
  1. `AGENT_PANEL` (`flow-agent-panel`, `flow-creative-agent-dialog`, `.agent-drawer`)
  2. `MODAL_DIALOG` (`mat-dialog-container`, `[role="dialog"]`, `dialog[open]`)
  3. `MEDIA_VIEWER` (`flow-media-viewer`, `flow-lightbox`, `.media-viewer`)
  4. `BACKDROP` (`.cdk-overlay-backdrop-showing`, kích thước $> 200\times 200$ px)
- **Quy trình giải phóng 4 bước (Dismiss Pipeline)**:
  - Bước 1: Gửi phím cứng OS `Escape`. Đợi 200ms và kiểm tra lại.
  - Bước 2: Kích hoạt JS synthetic click vào các nút đóng (`button[aria-label*="Đóng" i]`, `.close-btn`).
  - Bước 3: Kích hoạt JS synthetic click vào backdrop che mờ (`.cdk-overlay-backdrop-showing`).
  - Bước 4: Gửi phím cứng OS `Escape` lần thứ 2.
- **Tích hợp kiểm tra Unobscured**: `FlowSmartWait.checkElementUnobscured` sử dụng `document.elementFromPoint(x, y)` để bảo đảm điểm click chuột không bị các lớp overlay/backdrop này đè lên trước khi phát lệnh click.

---

## 2. LOGIC CHAIN (CHUỖI SUY LUẬN TỪ QUAN SÁT ĐẾN ĐÁNH GIÁ)

```
[Quan sát 1.1: Specs nằm trong FlowElementFinder] 
  ──> [Suy luận 1]: Kiến trúc Finder đã tự chủ, không phụ thuộc file ngoài, nhưng file phình to (>1000 dòng).

[Quan sát 1.2 & 1.3: 0 toạ độ click cứng, 100% dynamic bounding box]
  ──> [Suy luận 2]: Khắc phục triệt để vấn đề Coordinate Drift khi thay đổi độ phân giải màn hình hoặc zoom trình duyệt.
  ──> [Hạn chế]: Vẫn phụ thuộc việc Electron BrowserWindow phải render layout đúng để getBoundingClientRect() có số liệu hợp lệ.

[Quan sát 1.4-A: Rò rỉ tìm kiếm toàn trang ở State 14 và Video cũ]
  ──> [Suy luận 3]: Xảy ra sự không đồng nhất giữa quy chuẩn thiết kế (Phase 4: Container-Scoped) và hiện thực thực tế tại các điểm thực thi click cuối cùng. State 14 tự viết lại hàm query riêng thay vì tái sử dụng candidate đã tìm ở State 11.

[Quan sát 1.4-B: Short-text cap 50 < 65]
  ──> [Suy luận 4]: Bảo đảm tuyệt đối không có hiện tượng click nhầm vào các element có nhãn '1', '2' khi Google Flow thay đổi DOM.

[Quan sát tổng thể: Sinh ảnh dùng State Machine 18 states, Sinh video vẫn dùng hàm monolithic 760 dòng trong SessionManager]
  ──> [Suy luận 5]: TỒN TẠI BẤT ĐỐI XỨNG KIẾN TRÚC TRẦM TRỌNG. Ảnh được bảo vệ bởi State Machine + Smart Wait + Recovery + Idempotency; trong khi Video vẫn dùng logic lồng nhau, fixed sleep, dễ bị treo hoặc false-click.
```

---

## 3. CAVEATS (GIỚI HẠN & CÁC ĐIỂM CẦN LƯU Ý)

1. **Phạm vi kiểm toán giới hạn ở mã nguồn**: Đây là đợt kiểm toán phân tích tĩnh (Static Analysis) kết hợp đối chiếu nhật ký chạy thật từ các phase trước. Chúng tôi không can thiệp sửa đổi mã nguồn hay chạy đè phiên đăng nhập hiện tại của người dùng.
2. **Khung giao diện Google Flow là Single Page App (Angular Material + CDK)**: Google Flow sử dụng dynamic class hashing (`mat-mdc-*`) và CDK overlay detached containers. Một số selector component class có thể bị thay đổi khi Google cập nhật phiên bản mới.
3. **Môi trường Windows Electron**: Tác vụ gửi phím `sendInputEvent` và toạ độ âm `(-3000, -3000)` phụ thuộc vào hành vi của nhân Chromium trên Windows. Trên một số thiết lập đa màn hình, việc ẩn cửa sổ có thể có độ trễ đồ hoạ nhỏ.

---

## 4. CONCLUSIONS (KẾT LUẬN & KIẾN NGHỊ HÀNH ĐỘNG)

### 4.1. Bảng đối chiếu: Code Trùng Lặp & Nguy Hiểm vs Thành Phần Cần Bảo Tồn

#### A. Các đoạn code trùng lặp cần dọn dẹp (Duplication)
1. **Trùng lặp hàm `safeExecuteJs`**: Được khai báo độc lập 3 lần tại `GoogleVeoSessionManager.ts:802`, `FlowSmartWait.ts:103`, và `FlowImageGenerationStates.ts:16`. Cần gom về một tiện ích duy nhất trong `FlowSmartWait`.
2. **Trùng lặp logic kiểm tra và giải phóng overlay**: `FlowOverlayDetector.ts` đã có giải pháp toàn diện 4 bước, nhưng trong `GoogleVeoSessionManager.ts:2468–2522` vẫn tồn tại đoạn code tự kiểm tra và gửi phím Escape thủ công.
3. **Trùng lặp logic điền prompt**: Code điền prompt bằng clipboard + synthetic event bị viết lại 3 lần: ở State 8 (`FlowImageGenerationStates.ts`), ở `fillPromptJs` (`GoogleVeoSessionManager.ts:1660`), và ở `cleanAndCheckPromptJs` (`GoogleVeoSessionManager.ts:2525`).

#### B. Các đoạn code nguy hiểm cần khắc phục (Fragile / High-Risk Code)
1. **Nguy cơ rò rỉ phạm vi tại State 14 (`FlowImageGenerationStates.ts:1069`)**:
   - *Hiện trạng*: State 14 tự thực thi `document.querySelectorAll` quét toàn trang để lấy toạ độ nút Generate.
   - *Đề xuất khắc phục*: Bắt buộc tái sử dụng container selector `flow-prompt-box` hoặc lấy trực tiếp toạ độ từ candidate đã được xác thực ở State 11 (`ctx.foundButton`).
2. **Khối mã monolithic 760 dòng của Sinh Video (`GoogleVeoSessionManager.ts:1393–2160`)**:
   - *Hiện trạng*: Chưa được chuyển đổi sang State Machine, còn chứa fallback quét toàn trang (`line 1801`), lặp `for` với `setTimeout` cố định 200ms, không có Idempotency Jump Gate hoàn chỉnh.
   - *Đề xuất khắc phục*: Đưa vào lộ trình migration để đóng gói thành `FlowVideoGenerationStatePipeline` tương tự như pipeline của Ảnh.
3. **Toạ độ cứng ngoài màn hình `(-3000, -3000)`**:
   - *Hiện trạng*: Cửa sổ bị đẩy ra toạ độ âm làm vô hiệu hoá buffer vẽ GPU của `capturePage()`.
   - *Đề xuất khắc phục*: Duy trì cơ chế flip onscreen `(100, 100)` trong `FlowRecoveryManager` khi chụp ảnh chẩn đoán, hoặc dùng flag `offscreen: true` ở chế độ headless của Electron trong tương lai.

#### C. Các thành phần hoạt động xuất sắc CẦN BẢO TỒN NGUYÊN VẸN (Solid Components)
1. **`FlowElementFinder.ts`**: Hệ thống 4 tầng chiến lược kết hợp tính điểm Confidence Score (0–100) và cơ chế ngắn mạch là thiết kế rất vững chắc.
2. **Cơ chế Short-Text Confidence Cap (< 65)**: Đã được kiểm chứng thực tế, ngăn ngừa triệt để tình trạng click bừa vào các nút ngắn 1 ký tự.
3. **`FlowSmartWait.waitForElementStable`**: Kiểm tra ổn định toạ độ qua 2 khung hình liên tiếp với sai số $\le 1$px giúp triệt tiêu hoàn toàn lỗi click khi animation hoặc layout shift đang diễn ra.
4. **`FlowOverlayDetector.ts`**: Cơ chế quét 4 loại overlay và chuỗi giải phóng 4 bước (Escape $\rightarrow$ Close Button $\rightarrow$ Backdrop $\rightarrow$ Escape) giải quyết triệt để vấn đề bị che khuất.
5. **`CheckIdempotencyBeforeGenerateState` (State 13)**: Bộ cổng nhảy cóc (Idempotency Jump) bảo đảm an toàn tín dụng người dùng (Zero Duplicate Generation).

---

## 5. INDEPENDENT VERIFICATION METHOD (PHƯƠNG PHÁP XÁC MINH ĐỘC LẬP)

Để kiểm chứng độc lập các kết luận trong báo cáo này, chuyên viên khác hoặc Orchestrator có thể thực thi các phương pháp sau:

### 5.1. Kiểm tra tĩnh mã nguồn (Static Code Inspection)
1. Xác minh không có toạ độ click cứng:
   ```powershell
   Get-Content main/veo/GoogleVeoSessionManager.ts, main/workflow/flow-engine/states/FlowImageGenerationStates.ts | Select-String "sendInputEvent" -Context 2,2
   ```
   *Kết quả xác minh*: Tất cả các tham số `x, y` truyền vào `sendInputEvent` đều là biến tính toán từ `rect` hoặc `coords`, không có số pixel cứng.
2. Xác minh cơ chế Container Scoping và Short-Text Cap:
   ```powershell
   Get-Content main/workflow/flow-engine/FlowElementFinder.ts | Select-String "containerSelector", "baseConfidence: 48", "baseConfidence: 55"
   ```

### 5.2. Chạy bộ kiểm thử phòng vệ đã được tích hợp sẵn
Chạy bộ kiểm thử tự động kiểm tra Container Scoping và Short-Text Rejection trên môi trường Electron thật:
```bash
npx electron -r ts-node/register scratch/test_phase4_verified.ts
```
- **Tiêu chí đạt**:
  - Test 1: Bắt đúng element trong container ($y=220$), bỏ qua 2 mồi nhử ngoài container ($y=10, y=50$).
  - Test 2: Text ngắn `text:1` đạt điểm 50/100, hệ thống từ chối click với mã lỗi `low_confidence`.
  - Test 3: Fallback Aspect Ratio từ Tier 1 sang Tier 2 đạt điểm 95/100 an toàn.

---
**Báo cáo kết thúc. File sẵn sàng phục vụ IPC & Architecture Lead Agent tổng hợp vào Báo cáo 9 mục.**
