# BÁO CÁO KIỂM TOÁN CHUYÊN SÂU: SESSION, WINDOW LIFECYCLE & CONCURRENCY
**Track 2 — Session, Window & Concurrency Specialist**  
**Working Directory**: `d:\DEAN\DEAN\VANHSUB\.agents\specialist_session_concurrency`  
**Project Root**: `d:\DEAN\DEAN\VANHSUB`  
**Target Files**: `main/veo/GoogleVeoSessionManager.ts`, `main/workflow/dispatcher/GoogleFlowBrowserMutex.ts`, `main/veo/GoogleVeoAntiSpamGuard.ts`, `main/workflow/flow-engine/FlowRecoveryManager.ts`, `main/workflow/flow-engine/states/FlowImageGenerationStates.ts`, `main/workflow/executionEngine.ts`, `main/main.ts`

---

## 1. OBSERVATION (QUAN SÁT THỰC NGHIỆM & DẪN CHỨNG MÃ NGUỒN)

### 1.1. `GoogleVeoSessionManager.ts` & `lobbyWindow` Lifecycle

#### 1.1.1. Cấu hình Khởi tạo BrowserWindow & Toạ độ Offscreen
- **Vị trí**: `main/veo/GoogleVeoSessionManager.ts`, dòng 41-42, dòng 301-318:
```typescript
41: export const OFFSCREEN_X = -3000;
42: export const OFFSCREEN_Y = -3000;
...
301: this.lobbyWindow = new BrowserWindow({
302:   width: 1100,
303:   height: 800,
304:   minWidth: 800,
305:   minHeight: 600,
306:   x: OFFSCREEN_X,
307:   y: OFFSCREEN_Y,
308:   title: 'Sảnh Google Flow / Veo - Đăng nhập tài khoản Google để nhận Credit miễn phí',
309:   modal: false,
310:   autoHideMenuBar: true,
311:   webPreferences: {
312:     partition: 'persist:google_veo',
313:     nodeIntegration: false,
314:     contextIsolation: true,
315:     backgroundThrottling: false,
316:   },
317: });
```
- **Phân tích**: 
  - Window không thiết lập `show: false`, do đó Electron mặc định coi cửa sổ là "hiển thị", nhưng được đẩy ra tọa độ ngoài màn hình thực `(-3000, -3000)`. Thiết kế này nhằm giúp Chromium vẫn dựng DOM tree và nhận lệnh `sendInputEvent`, đồng thời cờ `backgroundThrottling: false` ngăn Chromium giảm xung nhịp timer (setInterval/setTimeout) khi cửa sổ không ở active foreground.
  - Tuy nhiên, cửa sổ này phục vụ mục đích kép: vừa là sảnh đăng nhập người dùng thực (khi gọi `showLobbyForDebug` tại dòng 2651 chuyển về tọa độ `100, 100`), vừa là worker tự động hoá ngầm tại `(-3000, -3000)`.

#### 1.1.2. Race Condition khi khởi tạo cửa sổ đồng thời (Orphaned Window Leak)
- **Vị trí**: `main/veo/GoogleVeoSessionManager.ts`, dòng 250-257, dòng 835-843:
```typescript
251: if (this.lobbyWindow && !this.lobbyWindow.isDestroyed()) {
252:   if (!this.isLobbyDebugVisible) {
253:     this.lobbyWindow.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
254:   }
255:   this.lobbyWindow.focus();
256:   return;
257: }
...
836: if (!this.lobbyWindow || this.lobbyWindow.isDestroyed()) {
837:   try {
838:     await this.openLobbyWindow();
839:   } catch (e) {
840:     console.warn('[Google Flow Browser] Không thể mở lobby window:', e);
841:     return false;
842:   }
843: }
```
- **Phân tích**: Hàm `openLobbyWindow()` là hàm `async` nhưng không có lock hay cờ guard `isOpening`. Nếu hai tác vụ bất đồng bộ gọi `ensureLobbyAtFlow()` hoặc `openLobbyWindow()` cùng lúc khi `this.lobbyWindow == null`, cả hai luồng đều vượt qua điều kiện kiểm tra và cùng tạo mới `new BrowserWindow(...)`. Kết quả là cửa sổ thứ nhất bị ghi đè tham chiếu bởi cửa sổ thứ hai, biến cửa sổ thứ nhất thành **Orphaned BrowserWindow** chạy ngầm vô hình, chiếm tài nguyên RAM/GPU và gây xung đột cookie/network.

#### 1.1.3. Thiếu hoàn toàn cơ chế xử lý Crash & Unresponsive (Zombified Window)
- **Vị trí**: `main/veo/GoogleVeoSessionManager.ts`, dòng 324-367:
  - Chỉ có 3 event listener được đăng ký trên window/webContents:
    - Dòng 324: `this.lobbyWindow.webContents.on('dom-ready', ...)`
    - Dòng 343: `this.lobbyWindow.webContents.on('did-navigate', ...)`
    - Dòng 361: `this.lobbyWindow.on('closed', () => { this.lobbyWindow = null; ... })`
- **Phân tích**:
  - Tuyệt đối **KHÔNG CÓ** các sự kiện then chốt của Electron:
    - `webContents.on('render-process-gone', (event, details) => ...)`
    - `webContents.on('unresponsive', () => ...)`
    - `webContents.on('plugin-crashed', () => ...)`
  - Khi tab Chromium của Google Flow bị OOM (Out of Memory) hoặc WebGL crash: Cửa sổ shell bên ngoài vẫn còn (`win.isDestroyed()` trả về `false`), nhưng tiến trình renderer đã chết ("White Screen of Death"). Khi đó, `safeExecuteJs` sẽ timeout (dòng 803) và mọi thao tác automation sau đó đều treo hoặc thất bại liên tục mà không có cơ chế tự động tái tạo cửa sổ (`relaunch` / `destroyAndRecreate`).

#### 1.1.4. Rò rỉ Event Listener trên Session (`MaxListenersExceededWarning`)
- **Vị trí**: `main/veo/GoogleVeoSessionManager.ts`, dòng 48, dòng 267-296, dòng 336-340:
```typescript
48:  private _webRequestListenerAttached = false;
...
268: ses.webRequest.onBeforeSendHeaders(
...
336: ses.cookies.on('changed', async (_event: any, cookie: any, _cause: any, removed: boolean) => {
337:   if (!removed && (GOOGLE_AUTH_COOKIE_NAMES.includes(cookie.name) || cookie.domain?.includes('google'))) {
338:     await this.syncCookiesFromPartition(ses);
339:   }
340: });
```
- **Phân tích**:
  - `ses` là phân vùng lưu trữ bền vững `session.fromPartition('persist:google_veo')` - một singleton tồn tại suốt vòng đời ứng dụng.
  - Cờ `_webRequestListenerAttached` được khai báo ở dòng 48 nhưng **KHÔNG BAO GIỜ ĐƯỢC ĐỌC HOẶC GHI** ở bất kỳ dòng nào khác trong toàn bộ file (dead code).
  - Mỗi khi người dùng đóng `lobbyWindow` và mở lại qua `openLobbyWindow()`, một hàm callback mới lại được gắn vào `ses.cookies.on('changed')` mà không hề được gỡ bỏ (`removeListener`). Nếu mở đóng sảnh 10 lần, sẽ có 10 listener chạy trùng lặp, gây cảnh báo Node.js EventEmitter memory leak và spam hàm ghi dữ liệu `syncCookiesFromPartition`.

---

### 1.2. `GoogleFlowBrowserMutex` & Concurrency Architecture

#### 1.2.1. Thiết kế của `GoogleFlowBrowserMutex`
- **Vị trí**: `main/workflow/dispatcher/GoogleFlowBrowserMutex.ts`, dòng 15-66:
```typescript
15: export class GoogleFlowBrowserMutex {
16:   private static instance: GoogleFlowBrowserMutex | null = null;
17:   private queue: Promise<any> = Promise.resolve();
18:   private storage = new AsyncLocalStorage<MutexContext>();
19:   private locked = false;
20:   private currentOwner: string | null = null;
...
36:   public async runExclusive<T>(task: () => Promise<T>, ownerId: string = 'anonymous'): Promise<T> {
37:     const existingStore = this.storage.getStore();
38: 
39:     // 1. Kiểm tra Re-entrant: Nếu cùng một chuỗi async call đã giữ lock này, cho phép chạy tiếp ngay
40:     if (existingStore) {
41:       return await task();
42:     }
43: 
44:     // 2. Xếp hàng đợi Promise (FIFO queue)
45:     const prev = this.queue;
46:     let release: () => void;
47:     this.queue = new Promise<void>((resolve) => {
48:       release = resolve;
49:     });
50: 
51:     try {
52:       await prev.catch(() => {});
53:       this.locked = true;
54:       this.currentOwner = ownerId;
55: 
56:       return await this.storage.run({ ownerId }, async () => {
57:         return await task();
58:       });
59:     } finally {
60:       this.locked = false;
61:       this.currentOwner = null;
62:       release!();
63:     }
64:   }
```
- **Điểm mạnh (Cần bảo tồn)**:
  - Khối `finally` đảm bảo gọi `release!()` trong 100% trường hợp ngay cả khi `task()` quăng ngoại lệ.
  - `await prev.catch(() => {})` giúp chuỗi hàng đợi không bị đứt gãy nếu một task phía trước bị fail.
  - Sử dụng `AsyncLocalStorage` cho phép hỗ trợ **Re-entrancy** rất tốt: nếu Task A đang giữ lock mà gọi tiếp hàm con Task B cũng yêu cầu lock, hàm B sẽ không bị deadlock mà chạy tiếp ngay lập tức.
- **Lỗ hổng & Nguy cơ Deadlock / Queue Stalling**:
  1. **Thiếu hoàn toàn cơ chế Lock Timeout**: `runExclusive` không có tham số `timeoutMs`. Nếu một task đang giữ lock rơi vào vòng lặp vô tận, unhandled promise hoặc CDP/DOM hang, toàn bộ chuỗi hàng đợi phía sau sẽ bị **treo vĩnh viễn (Permanent Queue Stall)** mà không thể phục hồi.
  2. **Không có cơ chế Abort / Cancel đối với tác vụ đang chờ trong Queue**: Nếu task đang xếp hàng đợi `prev` mà người dùng bấm Cancel workflow, task đó vẫn không bị loại khỏi hàng đợi, khi đến lượt nó vẫn sẽ chiếm lock và thực thi nếu không có guard kiểm tra ở đầu hàm `task`.
  3. **Mutex Singleton toàn cục không hỗ trợ Đa Profile**: `GoogleFlowBrowserMutex` là Singleton tĩnh duy nhất trên toàn process. Nếu sau này mở rộng chạy song song nhiều profile Google độc lập (Partition 1 và Partition 2), cơ chế này sẽ vô tình bắt các profile khác nhau phải chạy tuần tự không cần thiết.

#### 1.2.2. Xung đột hai cơ chế Mutex: `GoogleVeoAntiSpamGuard` vs `GoogleFlowBrowserMutex`
- **Vị trí**: `main/veo/GoogleVeoAntiSpamGuard.ts`, dòng 96-123:
```typescript
96:  async acquireLockAsync(options?: {
97:    onProgress?: (percent: number, message?: string) => void;
98:    isCancelled?: () => boolean;
99:  }): Promise<void> {
100:   if (this.isGenerating) {
...
105:     await new Promise<void>((resolve, reject) => {
106:       const watchdog = setTimeout(() => {
107:         this.releaseLock();
108:         resolve();
109:       }, 12_000);
...
126:   this.isGenerating = true;
```
- **Phân tích lỗi cực kỳ nghiêm trọng (CRITICAL CONCURRENCY BUG)**:
  - Hệ thống hiện tại có 2 cơ chế khoá song song: `GoogleFlowBrowserMutex` (mới) và `GoogleVeoAntiSpamGuard` (cũ).
  - Trong `GoogleFlowAdapter.ts` (dòng 96 và 762), tác vụ sử dụng `antiSpam.acquireLockAsync`.
  - Tại dòng 106-109 của `GoogleVeoAntiSpamGuard.ts`, có một **watchdog timeout 12 giây**! Khi có một video đang sinh (thường mất từ 30s đến 120s), tác vụ thứ 2 trong hàng đợi chỉ đợi đúng 12s thì watchdog kích hoạt: **tự động gọi `this.releaseLock()` và cho phép tác vụ 2 chạy tiếp (`resolve()`)**!
  - Hậu quả: Tác vụ 2 lập tức set `this.isGenerating = true` và can thiệp vào cùng một cửa sổ `lobbyWindow` trong khi tác vụ 1 vẫn đang render dở! Tính năng loại trừ tương hỗ (Mutual Exclusion) bị phá vỡ hoàn toàn sau 12 giây!

#### 1.2.3. Lỗ hổng bỏ lọt Mutex: `getCachedOrFreshCredits` phá huỷ giao diện đang sinh
- **Vị trí**: `main/main.ts`, dòng 746 và `main/veo/GoogleVeoSessionManager.ts`, dòng 894-987, 1000-1029:
```typescript
// main/main.ts:
745: ipcMain.handle('veo:get-credits', async (_event, maxAgeMs?: number) => {
746:   return GoogleVeoSessionManager.getInstance().getCachedOrFreshCredits(maxAgeMs);
747: });

// main/veo/GoogleVeoSessionManager.ts:
1016: const freshCredits = await this.readFlowCredits(this.lobbyWindow);
...
894:  // 1. Click vào nút/avatar mở panel tài khoản Google trên trang chính
895:  const clickAvatarJs = `
...
905:    el.click();
...
982:  await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
984:  await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
```
- **Phân tích lỗi xung đột UI trực tiếp (UI COLLISION RACE CONDITION)**:
  - IPC handler `veo:get-credits` được gọi từ UI Renderer (polling credit định kỳ hoặc khi người dùng mở trang cài đặt).
  - Hàm `getCachedOrFreshCredits()` **KHÔNG ĐƯỢC BẢO VỆ BỞI `GoogleFlowBrowserMutex`**!
  - Khi cache 20 phút hết hạn, hàm `readFlowCredits` thực hiện:
    1. Dùng DOM click trực tiếp lên avatar Google `a.gb_A` trên `lobbyWindow` để bật iframe panel tài khoản.
    2. Chờ 800ms để đọc text trong subframe `accounts.google.com`.
    3. Gửi phím `Escape` bằng `sendInputEvent` để đóng popup.
  - Nếu đúng lúc đó có một Workflow đang sinh ảnh hoặc video: Việc click vào avatar và nhấn Escape giữa chừng sẽ làm mất focus ô soạn thảo prompt, đóng mất các modal chọn tỷ lệ khung hình, hoặc ngắt quãng chuỗi `sendInputEvent` của quá trình sinh!

---

### 1.3. Canvas Cleanup & State Reset Logic

#### 1.3.1. Phân tích `ensureCleanCanvasReady`
- **Vị trí**: `main/veo/GoogleVeoSessionManager.ts`, dòng 2460-2648:
```typescript
2460: public async ensureCleanCanvasReady(
2461:   win: any,
2462:   mode: 'image' | 'video',
2463:   onProgress?: (percent: number, msg: string) => void,
2464:   isCancelled?: () => boolean
2465: ): Promise<boolean> {
```
- **Những việc đã làm được**:
  1. Kiểm tra các selector overlay/lightbox (`flow-media-viewer`, `.lightbox-overlay`, `[role="dialog"]`, `mat-dialog-container`) và gửi phím Escape hoặc tìm nút Close qua `FlowElementFinder.getCloseOverlaySpec()` (dòng 2469-2521).
  2. Xoá text trong ô soạn thảo prompt ProseMirror qua `document.execCommand('delete')` và phát sự kiện `input`, `change` (dòng 2560-2579).
  3. Gửi click chuột vật lý bằng `sendInputEvent` vào tọa độ ô prompt để xác lập OS focus (dòng 2614-2629).

#### 1.3.2. Những thiếu sót cốt lõi gây nhiễu dữ liệu (STALE STATE LEAKS)
1. **Tham số `mode` bị bỏ quên hoàn toàn**:
   - Dòng 2462 khai báo tham số `mode: 'image' | 'video'`, nhưng trong toàn bộ 188 dòng code của hàm `ensureCleanCanvasReady` (từ 2460 đến 2648), biến `mode` **KHÔNG HỀ ĐƯỢC SỬ DỤNG MỘT LẦN NÀO**! Không hề có logic chuyển đổi chế độ sinh giữa Image và Video trên giao diện Google Flow.
2. **Không xoá Chip ảnh tham chiếu cũ (Stale Image Ingredient Chip)**:
   - Trong `GoogleVeoSessionManager.ts`, dòng 1493-1495:
     ```typescript
     1493: const existingChip = promptBox ? promptBox.querySelector('flow-image-ingredient-chip, .chip-container, .chip-image-wrapper, mat-chip') : null;
     1494: if (existingChip) {
     1495:   return 'already_has_image_chip';
     1496: }
     ```
   - Hàm `ensureCleanCanvasReady` chỉ xoá text bằng `delete`, **hoàn toàn không xoá các phần tử `flow-image-ingredient-chip` hoặc nút bấm xoá chip (`button.remove-chip`)**!
   - Hậu quả: Nếu lượt sinh trước là Image-to-Video, chip ảnh cũ vẫn nằm nguyên trong ô prompt box. Lượt sinh tiếp theo dù là Text-to-Video hay Text-to-Image thuần tuý vẫn sẽ bị Google Flow nhận diện là có ảnh tham chiếu và sinh ra kết quả sai lệch hoàn toàn so với prompt mới.
3. **Hiện tượng nhặt nhầm ảnh cũ trên Canvas (`imageCards[imageCards.length - 1]`)**:
   - Dòng 1499-1501:
     ```typescript
     1499: const imageCards = Array.from(document.querySelectorAll('flow-image-tile')).filter(isVisible);
     1500: if (imageCards.length > 0) {
     1501:   const targetCard = imageCards[imageCards.length - 1];
     ```
   - Nếu trong một project đã sinh 5 ảnh trước đó, tác vụ sau không truyền `initFrameUrl` mới nhưng muốn dùng ảnh vừa tạo, nó sẽ mù quáng lấy thẻ cuối cùng trên DOM tree. Nếu cấu trúc hiển thị của Google Flow đảo ngược hoặc sắp xếp theo thời gian khác đi, hệ thống sẽ chọn sai ảnh.
4. **Không xoá các node/card cũ trên Canvas**:
   - Dòng 2634-2639:
     ```typescript
     2636: if (currentUrl.includes('/project/')) {
     2637:   console.log('[Google Flow Browser] Đang ở trong project, bảo toàn project context.');
     2638:   return true;
     2639: }
     ```
   - Để tối ưu thời gian không phải tạo project mới, hệ thống giữ nguyên project hiện tại. Nhưng các card ảnh/video cũ không hề được xoá. Điều này làm tăng kích thước DOM tree theo thời gian, gây tốn RAM của Chromium renderer process và tăng nguy cơ `FlowElementFinder` quét nhầm các nút của card cũ.
5. **Cướp quyền Clipboard hệ điều hành (OS Clipboard Hijacking)**:
   - Trong `FlowImageGenerationStates.ts`, dòng 455-458:
     ```typescript
     455: electron.clipboard.writeText(promptClean);
     456: ctx.win.focus();
     457: ctx.win.webContents.paste();
     ```
   - Việc gọi trực tiếp `electron.clipboard.writeText(promptClean)` sẽ ghi đè vào clipboard của toàn bộ hệ điều hành Windows! Người dùng đang làm việc khác (ví dụ copy mã số ngân hàng, văn bản) sẽ bất ngờ bị mất clipboard do automation chạy ngầm ghi đè prompt vào.

---

### 1.4. Offscreen vs Onscreen & `capturePage` Diagnostics

#### 1.4.1. Bản chất sự cố `capturePage()` khi đặt cửa sổ Offscreen
- **Vị trí**: `main/workflow/flow-engine/FlowRecoveryManager.ts`, dòng 161-195:
```typescript
168: origPosition = win.getPosition();
169: wasOffscreen = origPosition[0] < -1000 || origPosition[1] < -1000;
170: 
171: if (wasOffscreen) {
172:   console.log(`[FlowRecoveryManager] [${ctx.taskId}] 🔄 Tạm thời flip cửa sổ về màn hình chính (100, 100) để cấp GPU paint buffer cho capturePage...`);
173:   win.setPosition(100, 100);
174:   win.showInactive();
175:   await new Promise((r) => setTimeout(r, 100));
176: }
177: 
178: const image = await win.webContents.capturePage();
179: if (image && !image.isEmpty()) {
180:   screenshotPath = path.join(scratchDir, `${filenameBase}.png`);
181:   fs.writeFileSync(screenshotPath, image.toPNG());
182:   console.log(`[FlowRecoveryManager] 📸 ĐÃ LƯU ẢNH CHỤP MÀN HÌNH CHẨN ĐOÁN THÀNH CÔNG (${image.toPNG().length} bytes) tại: ${screenshotPath}`);
183: }
...
191: if (wasOffscreen && origPosition && win && !win.isDestroyed()) {
192:   win.setPosition(origPosition[0], origPosition[1]);
193:   console.log(`[FlowRecoveryManager] [${ctx.taskId}] 🔒 Đã đưa cửa sổ trở lại toạ độ offscreen ẩn: (${origPosition[0]}, ${origPosition[1]})`);
194: }
```
- **Phân tích kỹ thuật chuyên sâu**:
  - Tại sao lại phải flip cửa sổ về `(100, 100)`?
    Trên hệ điều hành Windows, Desktop Window Manager (DWM) và Chromium compositor tối ưu hoá bằng cách **không cấp phát GPU swap chain / presentation back-buffer** cho các cửa sổ nằm hoàn toàn ngoài không gian hiển thị của màn hình vật lý (ngoài `SM_XVIRTUALSCREEN`/`SM_YVIRTUALSCREEN`). Khi cửa sổ ở `(-3000, -3000)`, gọi `webContents.capturePage()` sẽ trả về `image.isEmpty() === true` (ảnh rỗng 0 bytes) hoặc màn hình đen hoàn toàn.
  - Tác dụng phụ của giải pháp "Flip onscreen tạm thời":
    1. **Chớp giật màn hình (Visual Pop-up & Flicker)**: Cửa sổ Google Flow tự dưng xuất hiện chớp nhoáng trên màn hình người dùng trong 100-200ms. Dù dùng `showInactive()`, trên nhiều bản Windows 10/11 nó vẫn có thể đè lên ứng dụng đang gõ phím.
    2. **Mã hoá PNG trùng lặp gây lãng phí CPU**: Dòng 181 gọi `image.toPNG()` để ghi file, dòng 182 lại gọi `image.toPNG().length` một lần nữa để log dung lượng! Với bitmap RGBA 1100x800 (~3.5MB uncompressed), việc nén PNG 2 lần liên tiếp làm tăng vọt CPU không cần thiết.
    3. **Rò rỉ đĩa cứng không giới hạn (Unbounded Disk Leak in `scratch/`)**:
       - Dòng 144: `const scratchDir = path.join(process.cwd(), 'scratch');`
       - Dòng 154: `fs.writeFileSync(domPath, domHtml, 'utf-8');`
       - Dòng 181: `fs.writeFileSync(screenshotPath, image.toPNG());`
       - Toàn bộ DOM snapshots (`.html`) và screenshots (`.png`) được ghi dồn vào thư mục `scratch/` mà **không hề có chính sách xoá file cũ, không có giới hạn dung lượng tối đa (Max Retention Policy)**. Sau một thời gian chạy tự động hoá gặp lỗi, thư mục này có thể phình to hàng chục Gigabytes.

---

### 1.5. Phân Định Code Nguy Hiểm vs Thành Phần Ổn Định

| Phân nhóm | Thành phần & File | Đánh giá chi tiết |
|---|---|---|
| 🔴 **Rất nguy hiểm (P0)** | `GoogleVeoAntiSpamGuard.ts` (dòng 106-109) | Watchdog 12s tự giải phóng lock trong khi video sinh mất 30-120s, phá vỡ tính độc quyền, dẫn đến 2 luồng cùng can thiệp 1 cửa sổ. |
| 🔴 **Rất nguy hiểm (P0)** | `main/main.ts` (dòng 746) & `GoogleVeoSessionManager.ts` (dòng 894, 982) | `veo:get-credits` gọi `readFlowCredits` click DOM và bấm Escape trên `lobbyWindow` mà không qua Mutex, phá hỏng workflow đang chạy. |
| 🔴 **Nguy hiểm (P1)** | `GoogleVeoSessionManager.ts` (dòng 324-367) | Thiếu handler `render-process-gone` và `unresponsive`. Khi renderer crash, ứng dụng bị đóng băng vĩnh viễn ở các bước sau. |
| 🔴 **Nguy hiểm (P1)** | `GoogleVeoSessionManager.ts` (dòng 2460-2648) | `ensureCleanCanvasReady` không xoá chip ảnh cũ (`flow-image-ingredient-chip`), gây ô nhiễm ảnh tham chiếu chéo giữa các lượt sinh. |
| 🟡 **Cần khắc phục (P2)** | `GoogleVeoSessionManager.ts` (dòng 336-340) | Rò rỉ EventListener `ses.cookies.on('changed')` mỗi lần mở sảnh, gây MaxListenersExceededWarning. |
| 🟡 **Cần khắc phục (P2)** | `FlowImageGenerationStates.ts` (dòng 455) | Cướp quyền OS Clipboard của người dùng bằng `electron.clipboard.writeText`. |
| 🟡 **Cần khắc phục (P2)** | `FlowRecoveryManager.ts` (dòng 144, 181) | Ghi file chẩn đoán vào `scratch/` không có giới hạn xoá dọn (Disk leak) và flip cửa sổ gây nháy hình. |
| 🟢 **Ổn định - Bảo tồn (P3)** | `GoogleFlowBrowserMutex.ts` (dòng 36-66) | Cơ chế Promise-chaining FIFO queue kết hợp `AsyncLocalStorage` hỗ trợ Re-entrancy an toàn, cần giữ lại làm Mutex chuẩn duy nhất. |
| 🟢 **Ổn định - Bảo tồn (P3)** | `GoogleVeoSessionManager.ts` (dòng 72-152, 183-200) | Logic `restoreCookiesToPartition`, `cleanAndDeduplicateCookies` và User-Agent spoofing hoạt động xuất sắc, vượt qua bot check Google. |
| 🟢 **Ổn định - Bảo tồn (P3)** | `FlowImageGenerationStates.ts` (dòng 661-733) | `CaptureBaselineState` với kỹ thuật Baseline URL snapshot + DOM tagging `data-flow-existing` + Time Gate hoạt động cực kỳ tin cậy. |
| 🟢 **Ổn định - Bảo tồn (P3)** | `FlowImageGenerationStates.ts` (dòng 932-1010) | `CheckIdempotencyBeforeGenerateState` phát hiện UI đang sinh để Idempotency Jump bỏ qua click thừa, rất chính xác. |

---

## 2. LOGIC CHAIN (CHUỖI SUY LUẬN TỪ QUAN SÁT ĐẾN KẾT LUẬN)

```
[Quan sát 1.2.2]: GoogleVeoAntiSpamGuard có watchdog 12s tự động releaseLock()
   +
[Quan sát 1.1.1]: GoogleVeoSessionManager sử dụng DUY NHẤT 1 cửa sổ lobbyWindow dùng chung
   ↓ (Suy luận 1)
Khi tác vụ A đang sinh video (mất 40s), tác vụ B vào hàng đợi. Sau 12s, watchdog giải phóng lock cho tác vụ B.
Tác vụ B bắt đầu gửi sendInputEvent và dọn canvas trong khi tác vụ A đang render -> Tác vụ A bị huỷ hoặc bắt nhầm video của tác vụ B.

[Quan sát 1.2.3]: IPC 'veo:get-credits' gọi getCachedOrFreshCredits() không có Mutex
   +
[Quan sát 1.2.3]: readFlowCredits() thực hiện click DOM vào avatar và gửi phím Escape
   ↓ (Suy luận 2)
UI Renderer polling credit định kỳ sẽ kích hoạt click và Escape ngẫu nhiên ngay giữa lúc Workflow đang chọn dropdown hoặc gõ prompt.
Gây ra lỗi UI interaction thất bại không thể giải thích (flaky error).

[Quan sát 1.3.2]: ensureCleanCanvasReady() chỉ xoá text, không xoá thẻ <flow-image-ingredient-chip>
   +
[Quan sát 1.3.2]: generateVideoViaBrowserContext() kiểm tra chip ảnh trước tiên
   ↓ (Suy luận 3)
Một lần sinh Image-to-Video thành công sẽ để lại chip ảnh vĩnh viễn trong prompt box cho các lần sinh kế tiếp.
Các prompt sinh Text-to-Video tiếp theo sẽ bị Google ép dùng ảnh cũ làm tham chiếu, làm hỏng toàn bộ kịch bản phim.

[Quan sát 1.1.3]: Thiếu webContents.on('render-process-gone')
   +
[Quan sát 1.2.1]: GoogleFlowBrowserMutex không có lock acquisition timeout
   ↓ (Suy luận 4)
Khi trang web Google Flow bị crash renderer (OOM sau nhiều lần render video):
safeExecuteJs() bị timeout hoặc treo, Promise không bao giờ hoàn tất hoặc chuỗi task liên tục fail.
Cửa sổ không bao giờ được reload/recreate, toàn bộ pipeline dừng hoạt động cho đến khi khởi động lại ứng dụng.
```

---

## 3. CAVEATS (GIỚI HẠN PHẠM VI & GIẢ ĐỊNH)

1. **Phạm vi kiểm toán tĩnh**: Do tuân thủ tuyệt đối quy định **Read-Only Audit**, không có code nào được chạy thử với tài khoản Google thật trong phiên kiểm toán này. Các phân tích dựa trên việc đối soát trực tiếp mã nguồn TypeScript và cơ chế nội tại của Electron/Chromium.
2. **Khác biệt nền tảng OS**: Hiện tượng `capturePage` trả về buffer rỗng khi ở ngoài màn hình được quan sát chủ yếu trên Windows DWM. Trên macOS hoặc Linux (X11/Wayland), hành vi offscreen back-buffer có thể có sự khác biệt nhỏ về hiệu năng.
3. **Google Flow DOM Updates**: Google có thể thay đổi tên các thẻ custom elements (ví dụ từ `flow-prompt-box` sang tên khác). Hệ thống đã có `FlowElementFinder` làm lớp bảo vệ mềm, nhưng việc dọn dẹp chip vẫn phụ thuộc vào selector.

---

## 4. CONCLUSION & ACTIONABLE RECOMMENDATIONS (KẾT LUẬN & ĐỀ XUẤT HÀNH ĐỘNG)

### 4.1. Kết luận Đánh giá
1. **Kiến trúc Session & Cookie**: Rất tốt. Phần `restoreCookiesToPartition`, đồng bộ cookie và loại bỏ Client Hints `sec-ch-ua` hoạt động ổn định và chính xác.
2. **Kiến trúc Khóa & Đồng thời**: **Bị phân mảnh nghiêm trọng**. Tồn tại song song 2 hệ thống khoá (`GoogleFlowBrowserMutex` và `GoogleVeoAntiSpamGuard`) với logic đối nghịch (một bên re-entrant FIFO, một bên watchdog 12s phá vỡ khoá). Lại có các luồng IPC bypass hoàn toàn khoá (`veo:get-credits`).
3. **Canvas Reset**: Mới chỉ làm sạch phần bề mặt (text của prompt box và modal overlay), chưa xử lý gốc rễ rác dữ liệu (chip ảnh, card cũ trên canvas, clipboard OS).
4. **Quản lý Vòng đời Cửa sổ**: Cần bổ sung watchdog phục hồi khi renderer crash và đóng gói lại việc chụp ảnh chẩn đoán tránh flip giật màn hình.

### 4.2. Đề xuất Kỹ thuật Cụ thể cho Phase 7 (Task Queue & Concurrency Hardening)

#### Đề xuất 1: Hợp nhất toàn bộ Concurrency về một Mutex duy nhất có Timeout
- **Hành động**: 
  - Khai tử hoàn toàn logic lock trong `GoogleVeoAntiSpamGuard.ts` (xoá bỏ watchdog 12s nguy hiểm). Chuyển `GoogleVeoAntiSpamGuard` chỉ làm nhiệm vụ tính toán Cooldown và Jitter.
  - Nâng cấp `GoogleFlowBrowserMutex.ts`: Thêm tham số `timeoutMs` (ví dụ mặc định 300,000ms cho video, 60,000ms cho ảnh) để tự động reject và giải phóng lock nếu task bị treo.
  - Bắt buộc bọc `GoogleFlowBrowserMutex.getInstance().runExclusive(...)` cho **TẤT CẢ** các entry point tương tác với `lobbyWindow`, bao gồm cả `readFlowCredits` trong `getCachedOrFreshCredits`.

#### Đề xuất 2: Nâng cấp `ensureCleanCanvasReady` xử lý triệt để Stale State
- **Hành động**:
  - Thêm bước quét và click vào nút xoá chip ảnh:
    ```javascript
    const chips = document.querySelectorAll('flow-image-ingredient-chip, .chip-container, mat-chip');
    chips.forEach(c => {
      const rmBtn = c.querySelector('button, [role="button"], .remove-chip, .close-icon');
      if (rmBtn) rmBtn.click();
    });
    ```
  - Thay thế việc ghi đè Clipboard OS (`electron.clipboard.writeText`) bằng cơ chế thuần DOM `ClipboardEvent` với `DataTransfer` hoặc Input Event giả lập để không chiếm đoạt clipboard của người dùng.

#### Đề xuất 3: Cài đặt Crash & Unresponsive Watchdog cho `lobbyWindow`
- **Hành động**:
  - Đăng ký sự kiện trong `openLobbyWindow()`:
    ```typescript
    this.lobbyWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[Google Flow] Renderer process gone:', details.reason);
      this.lobbyWindow?.destroy();
      this.lobbyWindow = null;
    });
    this.lobbyWindow.on('unresponsive', () => {
      console.warn('[Google Flow] Window unresponsive, reloading...');
      this.lobbyWindow?.reload();
    });
    ```

#### Đề xuất 4: Tối ưu hoá Diagnostic Capture & Dọn dẹp Disk Leak
- **Hành động**:
  - Trong `FlowRecoveryManager.ts`:
    1. Chỉ gọi `image.toPNG()` một lần duy nhất, lưu vào biến `const pngBuf = image.toPNG();`.
    2. Cài đặt cơ chế xoá xoay vòng (Retention Policy) cho thư mục `scratch/`: chỉ giữ lại tối đa 20 file chẩn đoán mới nhất, tự động xoá các file cũ hơn 24 giờ.
    3. (Tuỳ chọn nâng cao): Sử dụng CDP `webContents.debugger.sendCommand('Page.captureScreenshot')` thay cho `capturePage` để chụp trực tiếp từ compositor mà không cần flip vị trí cửa sổ.

---

## 5. VERIFICATION METHOD (HƯỚNG DẪN KIỂM CHỨNG ĐỘC LẬP)

Để kiểm chứng độc lập các kết luận trong báo cáo này, kiểm toán viên tiếp theo có thể thực hiện:

1. **Kiểm chứng Watchdog Bug của `GoogleVeoAntiSpamGuard`**:
   - Mở file `main/veo/GoogleVeoAntiSpamGuard.ts`, kiểm tra dòng 106-109.
   - Xác nhận sự tồn tại của `const watchdog = setTimeout(() => { this.releaseLock(); resolve(); }, 12_000);`.
   - Đối chiếu với thời gian render trung bình của Google Veo trong `GoogleVeoSessionManager.ts` dòng 2038 (`maxWaitSeconds = 240`). Kết luận: Watchdog 12s vi phạm tính toàn vẹn của lock.

2. **Kiểm chứng Lỗ hổng Bypass Mutex của Credit Check**:
   - Mở file `main/main.ts`, dòng 745-747: Xác nhận `ipcMain.handle('veo:get-credits', ...)` gọi thẳng `getCachedOrFreshCredits()`.
   - Mở file `main/veo/GoogleVeoSessionManager.ts`, dòng 1000-1029: Xác nhận không có sự hiện diện của `GoogleFlowBrowserMutex`.
   - Mở dòng 894-910 và dòng 982-985: Xác nhận có lệnh `el.click()` vào avatar và `sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })`.

3. **Kiểm chứng Rò rỉ Chip ảnh trong Canvas Reset**:
   - Mở file `main/veo/GoogleVeoSessionManager.ts`, dòng 2460-2648 (`ensureCleanCanvasReady`).
   - Tìm kiếm từ khoá `chip` trong toàn bộ thân hàm: Hoàn toàn không có lệnh nào xoá thẻ `flow-image-ingredient-chip`.

4. **Kiểm chứng Rò rỉ Đĩa cứng trong `FlowRecoveryManager`**:
   - Mở file `main/workflow/flow-engine/FlowRecoveryManager.ts`, dòng 144-185.
   - Xác nhận các file `.html` và `.png` được ghi vào `scratchDir` bằng `fs.writeFileSync` mà không có hàm unlink / clean-up nào.
