# BÁO CÁO KIỂM TOÁN VÀ LỘ TRÌNH REFACTOR HỆ THỐNG TỰ ĐỘNG HÓA GOOGLE FLOW
**Dự án**: Google Flow Automation Engine (Electron + TypeScript)  
**Đơn vị thực hiện**: Full-Team Specialized Audit (Orchestrator, UI & DOM Specialist, Session & Concurrency Specialist, Error & Recovery Specialist, IPC & Architecture Lead)  
**Ngày kiểm toán**: 2026-09-16  
**Chế độ kiểm toán**: **READ-ONLY AUDIT** (Tuyệt đối không sửa đổi mã nguồn, không làm thay đổi git status)  
**Vị trí tài liệu**: `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_1\AUDIT_REPORT.md`  

---

## MỤC LỤC BÁO CÁO (9 MỤC TỪ A ĐẾN I)
- [A. Sơ đồ kiến trúc hiện tại: Luồng dữ liệu và các lớp điều phối](#a-sơ-đồ-kiến-trúc-hiện-tại-luồng-dữ-liệu-và-các-lớp-điều-phối)
- [B. Danh sách entry point (file + function): Tiếp nhận yêu cầu tạo ảnh/video](#b-danh-sách-entry-point-file--function-tiếp-nhận-yêu-cầu-tạo-ảnhvideo)
- [C. Các phương pháp automation đang tồn tại: Tỷ lệ phối hợp và cơ chế định vị](#c-các-phương-pháp-automation-đang-tồn-tại-tỷ-lệ-phối-hợp-và-cơ-chế-định-vị)
- [D. Danh sách các đoạn code trùng lặp: Logic lặp qua nhiều file](#d-danh-sách-các-đoạn-code-trùng-lặp-logic-lặp-qua-nhiều-file)
- [E. Các đoạn code nguy hiểm: Hardcoded coordinates, race conditions, loops, leaks](#e-các-đoạn-code-nguy-hiểm-hardcoded-coordinates-race-conditions-loops-leaks)
- [F. Các thành phần đang hoạt động ổn định cần bảo tồn](#f-các-thành-phần-đang-hoạt-động-ổn-định-cần-bảo-tồn)
- [G. Sơ đồ kiến trúc đề xuất: State Machine + Self-Healing + Task Queue](#g-sơ-đồ-kiến-trúc-đề-xuất-state-machine--self-healing--task-queue)
- [H. Lộ trình migration theo từng bước nhỏ (Phase 1 đến Phase 10)](#h-lộ-trình-migration-theo-từng-bước-nhỏ-phase-1-đến-phase-10)
- [I. Bước đầu tiên nhỏ nhất có giá trị cao nhất để tiếp tục (Phase 7 Scope & AC)](#i-bước-đầu-tiên-nhỏ-nhất-có-giá-trị-cao-nhất-để-tiếp-tục-phase-7-scope--ac)

---

## A. SƠ ĐỒ KIẾN TRÚC HIỆN TẠI: LUỒNG DỮ LIỆU VÀ CÁC LỚP ĐIỀU PHỐI

### A.1. Sơ đồ Luồng Dữ liệu Toàn trình (End-to-End Architecture Data Flow)

Hệ thống điều phối tự động hóa Google Flow trong ứng dụng Vanhsub được tổ chức thành **5 Lớp Trừu tượng (5 Abstraction Layers)** từ giao diện người dùng ReactFlow xuống phần cứng Chromium WebContents:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ LỚP 1: UI / PRESENTATION LAYER (React + Zustand + ReactFlow)                                     │
│   ├── WorkflowCanvas.tsx (Điều khiển DAG Canvas, thanh công cụ Run/Cancel, hiển thị node status) │
│   ├── Inspector.tsx (Hiệu chỉnh prompt, aspect ratio 16:9/9:16/1:1, model parameters)           │
│   ├── MasterTimeline.tsx (Ghép clip video qua FFmpeg, preview timeline)                          │
│   ├── ApiKeyConfigModal.tsx (Cấu hình Session, mở sảnh đăng nhập, anti-spam status UI)          │
│   └── workflowStore.ts (Zustand Store: graphId, nodes[], edges[], runtimeMap, node status)       │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ window.vanhsub.workflow.* / window.vanhsub.veo.*
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ LỚP 2: PRELOAD BRIDGE & IPC LAYER (Electron Context Isolation)                                   │
│   ├── main/preload.ts (contextBridge.exposeInMainWorld('vanhsub', { workflow, veo, tasks... }))  │
│   ├── main/workflow/ipc.ts (ipcMain.handle: 'workflow:run', 'workflow:runNode', 'workflow:cancel')│
│   │     └── Push Events: event.sender.send('workflow:node-event', nodeEvent)                     │
│   └── main/main.ts (ipcMain.handle: 'veo:*', 'tasks:*', 'dialog:*', 'settings:*')                │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ engine.execute(graph, callback)
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ LỚP 3: SERVICE / ORCHESTRATION LAYER (DAG Scheduling & In-Memory Concurrency)                    │
│   ├── WorkflowExecutionEngine.ts (Kahn's Topo Sort, Cycle Detection, Node Dispatcher)            │
│   │     [⚠️ GAPS: WorkflowGraphEngine.ts trong dispatcher/ có branch/loop nhưng CHƯA NỐI IPC]     │
│   ├── AdapterRegistry.ts (Quản lý Model Adapters) ➔ GoogleFlowAdapter.ts                         │
│   └── Hệ thống Kiểm soát Đồng thì In-Memory (Phân mảnh 3 bộ điều phối):                          │
│         ├── GoogleFlowBrowserMutex.ts (Promise FIFO Lock + AsyncLocalStorage Re-entrancy)        │
│         ├── GoogleVeoAntiSpamGuard.ts (FIFO Queue + Cooldown 8s + Watchdog 12s ⚠️ NGUY HIỂM)     │
│         └── OnlineImageRateLimiter.ts (Delay 2.5s in-memory chống HTTP 429)                      │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ sessionMgr.generateImageViaBrowserContext /
                                                 │ generateVideoViaBrowserContext
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ LỚP 4: AUTOMATION & FLOW ENGINE LAYER (GoogleVeoSessionManager & State Machine)                   │
│   ├── GoogleVeoSessionManager.ts (Singleton quản lý Session, LobbyWindow, Cookie Sync RFC 6265) │
│   │                                                                                              │
│   ├── [NHÁNH ẢNH: Chuẩn hóa Phase 2 - 6 qua State Machine]                                       │
│   │     └── FlowStateMachine.ts (18 Trạng thái Tường minh: Enter ➔ Execute ➔ Verify ➔ Exit)      │
│   │           ├── FlowImageGenerationStates.ts (18 states, Verify Data Criteria, Baseline Tag)   │
│   │           ├── FlowElementFinder.ts (4 Tiers: ACCESSIBILITY ➔ STRICT ➔ CONTEXTUAL ➔ TEXT)     │
│   │           │     ├── Container Scoping (Cô lập phạm vi trong prompt box, dialog)              │
│   │           │     └── Short-Text Protection (baseConfidence 48, trần 50 < 65 Safe Threshold)   │
│   │           ├── FlowSmartWait.ts (Adaptive Polling 500-1000ms, 5-layer Stability Check <= 1px) │
│   │           ├── FlowRecoveryManager.ts (Auto-dismiss overlay 4 bước, DOM & Screenshot Dump)    │
│   │           ├── FlowOverlayDetector.ts (Escape ➔ Close Button ➔ Backdrop ➔ Escape)             │
│   │           ├── FlowPageStateDetector.ts (7 Page States: HOME, EDITOR, IN_PROGRESS, LOGIN...)  │
│   │           ├── FlowErrorClassifier.ts (13 mã lỗi tập trung: FATAL, NON_RETRYABLE, RETRYABLE)  │
│   │           └── FlowRetryManager.ts (Exponential Backoff + Full Jitter +-20%, Idempotency Jump)│
│   │                                                                                              │
│   └── [NHÁNH VIDEO: Mã Thủ tục Di sản (Legacy Procedural Backlog)]                               │
│         └── generateVideoViaBrowserContext() (main/veo/GoogleVeoSessionManager.ts:1393-2169)     │
│               ├── 760 dòng mã tuần tự, KHÔNG dùng State Machine                                  │
│               ├── executeJavaScript trực tiếp, fixed sleeps, rò rỉ tìm kiếm document-wide        │
│               └── KHÔNG CÓ Idempotency Guard (Timeout 240s kích hoạt retry bấm nút lần 2)        │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ sendInputEvent, executeJavaScript, webRequest
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ LỚP 5: BROWSER / DRIVER LAYER (Electron Chromium WebContents)                                    │
│   ├── BrowserWindow lobbyWindow (partition: 'persist:google_veo', backgroundThrottling: false)   │
│   │     └── Tọa độ chạy ngầm: OFFSCREEN_X = -3000, OFFSCREEN_Y = -3000                           │
│   ├── Chromium webContents:                                                                      │
│   │     ├── sendInputEvent: mouseDown/mouseUp/mouseMove tại toạ độ getBoundingClientRect() thật │
│   │     ├── sendInputEvent: phím cứng Escape (đóng overlay) và Enter (hỗ trợ form submit)        │
│   │     └── executeJavaScript: DOM query, bóc tách Blob URL, tải trực tiếp qua Fetch trong web   │
│   └── Network Interception & Cookie Sync:                                                        │
│         ├── session.webRequest.onBeforeSendHeaders (Spoof User-Agent, xóa sec-ch-ua Client Hints)│
│         └── session.cookies (Đồng bộ cookie xác thực Google Auth sang file JSON)                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### A.2. Đánh giá 3 Khoảng trống và Bất đối xứng Kiến trúc Lớn

1. **Sự Phân Hoá Sâu Sắc Giữa Image Engine và Video Engine**:
   - Nhánh Sinh Ảnh (`generateImageViaBrowserContext`) đã được tái cấu trúc hoàn chỉnh từ Phase 2 đến Phase 6 với 18 trạng thái tường minh, Verify-After-Action, Self-Healing và Idempotency Jump.
   - Nhánh Sinh Video (`generateVideoViaBrowserContext`) vẫn nằm lại trong `GoogleVeoSessionManager.ts` dưới dạng khối mã đơn khối (monolithic) gần 800 dòng, không có State Machine, không có Idempotency Guard, gây nguy cơ sinh trùng video và tiêu hao credit rất lớn.
2. **Sự Phân Mảnh Giữa Hai Bộ Đồ Thị (Execution Engine vs Graph Engine)**:
   - `WorkflowExecutionEngine.ts` (1,062 dòng) là engine duy nhất được gắn vào IPC `workflow:run` (`main/workflow/ipc.ts:10`).
   - `WorkflowGraphEngine.ts` (615 dòng tại `main/workflow/dispatcher/`) hỗ trợ các tính năng nâng cao (rẽ nhánh điều kiện, vòng lặp, Shared State Store) nhưng chưa được nối vào IPC, tạo ra sự phân mảnh tính năng trong codebase.
3. **Toàn Bộ Cơ Chế Đồng Thì Đang Là In-Memory Thuần Túy**:
   - Cả 4 hàng đợi (`GoogleFlowBrowserMutex`, `GoogleVeoAntiSpamGuard`, `OnlineImageRateLimiter`, `pipelineQueued`) đều lưu trữ trên RAM Node.js heap. Khi ứng dụng bị crash hoặc người dùng khởi động lại, toàn bộ trạng thái hàng đợi biến mất, không có cơ chế Checkpoint lưu đĩa để tiếp tục công việc đang dang dở.

---

## B. DANH SÁCH ENTRY POINT (FILE + FUNCTION): TIẾP NHẬN YÊU CẦU TẠO ẢNH/VIDEO

Toàn bộ hệ thống có **37 kênh IPC** được đăng ký giữa Renderer Process và Main Process. Dưới đây là danh mục chi tiết, phân loại theo miền nghiệp vụ:

### B.1. Miền Workflow, Flow Engine & AI Generation (Điểm Tiếp Nhận Chính)

| STT | Kênh IPC | File & Dòng (Main Process) | Handler Function | Tham số nhận (Params) | Kiểu dữ liệu trả về | Điểm gọi UI (Renderer Caller) | Mô tả nghiệp vụ |
|:---:|---|---|---|---|---|---|---|
| 1 | `workflow:run` | `main/workflow/ipc.ts:14` | `engine.execute(graph, callback)` | `event, graph: WorkflowGraphData` | `Promise<{ success: boolean; outputs: Record<string, any>; error?: string }>` | `renderer/components/workflow/WorkflowCanvas.tsx:416` | **Entry Point số 1**: Tiếp nhận đồ thị DAG từ UI Canvas, kiểm tra chu trình và kích hoạt thực thi workflow tạo ảnh/video |
| 2 | `workflow:runNode` | `main/workflow/ipc.ts:28` | `engine.executeNode(graph, nodeId, callback)` | `event, graph: WorkflowGraphData, nodeId: string` | `Promise<{ success: boolean; output?: any; error?: string }>` | `renderer/lib/store/workflowStore.ts:316` | **Entry Point số 2**: Chạy thử nghiệm đơn lẻ một node (node prompt, node tạo ảnh, node tạo video) |
| 3 | `workflow:cancel` | `main/workflow/ipc.ts:42` | `engine.cancel(workflowId)` | `event, workflowId: string` | `Promise<boolean>` | `renderer/components/workflow/WorkflowCanvas.tsx:791` | Huỷ bỏ luồng thực thi workflow đang chạy; loại bỏ `workflowId` khỏi danh sách đang xử lý |
| 4 | `workflow:compareFrames` | `main/workflow/ipc.ts:48` | `QcEngine.evaluate(frameA, frameB, config)` | `event, frameAPath: string, frameBPath: string, config?: QcConfig` | `Promise<{ passed: boolean; score: number; colorDelta: number; status: 'pass'\|'warn'\|'fail'; details: string }>` | `renderer/types/electron.d.ts:360` | Kiểm tra chất lượng và độ tương đồng khung hình (QC) giữa các video clip |
| 5 | `workflow:concatClips` | `main/workflow/ipc.ts:56` | `VideoProcessor.concatVideos(clipPaths, dest)` | `event, clipPaths: string[], outPath?: string` | `Promise<string>` | `renderer/components/workflow/MasterTimeline.tsx:116` | Ghép nối các đoạn video clip được sinh ra thành timeline hoàn chỉnh bằng FFmpeg |
| 6 | `workflow:getVideoDuration` | `main/workflow/ipc.ts:61` | `VideoProcessor.getVideoDuration(videoPath)` | `event, videoPath: string` | `Promise<number>` | `renderer/types/electron.d.ts:368` | Đo độ dài thời lượng video (giây) qua FFprobe |
| 7 | `workflow:node-event` *(Push)* | `main/workflow/ipc.ts:20, 34` | `webContents.send('workflow:node-event', nodeEvent)` | `nodeEvent: WorkflowNodeEvent` (nodeId, status, progress, outputData, error) | `void` | `renderer/components/workflow/WorkflowCanvas.tsx:301` | Bắn sự kiện tiến độ realtime từ Execution Engine lên UI để cập nhật trạng thái node |

### B.2. Miền Quản lý Phiên Google Veo / Flow Sảnh & Chống Bot

| STT | Kênh IPC | File & Dòng (Main Process) | Handler Function | Tham số nhận (Params) | Kiểu dữ liệu trả về | Điểm gọi UI (Renderer Caller) | Mô tả nghiệp vụ |
|:---:|---|---|---|---|---|---|---|
| 8 | `veo:open-lobby` | `main/main.ts:697` | `GoogleVeoSessionManager.getInstance().openLobbyWindow(mainWindow)` | Không tham số | `Promise<{ ok: boolean; error?: string }>` | `WorkflowCanvas.tsx:185`, `ApiKeyConfigModal.tsx:144` | Khởi tạo hoặc focus cửa sổ `lobbyWindow` (partition `persist:google_veo`) để người dùng đăng nhập tài khoản Google |
| 9 | `veo:status` | `main/main.ts:706` | `GoogleVeoSessionManager.getInstance().getStatus()` | Không tham số | `Promise<VeoStatusPayload>` (mode, hasSession, email, credits...) | `WorkflowCanvas.tsx:167`, `ApiKeyConfigModal.tsx:97` | Trả về trạng thái phiên đăng nhập hiện tại, email và hạn mức credit |
| 10 | `veo:validate` | `main/main.ts:710` | `GoogleVeoSessionManager.getInstance().validateSession()` | Không tham số | `Promise<{ valid: boolean; status: string; detail: string; email?: string }>` | `ApiKeyConfigModal.tsx:163` | Kiểm tra kết nối thật tới `https://flow.google.com/` để xác nhận session còn sống hay đã hết hạn |
| 11 | `veo:save-session` | `main/main.ts:714` | `GoogleVeoSessionManager.getInstance().saveManualSession(rawInput)` | `event, rawInput: string` | `Promise<{ ok: boolean; result?: any; error?: string }>` | `ApiKeyConfigModal.tsx:203` | Nhập chuỗi cookie thủ công hoặc token xác thực từ bên ngoài |
| 12 | `veo:clear-session` | `main/main.ts:723` | `GoogleVeoSessionManager.getInstance().clearSession()` | Không tham số | `Promise<{ ok: boolean; error?: string }>` | `ApiKeyConfigModal.tsx:224` | Xóa sạch cookie trong partition và thiết lập trạng thái về `unauthenticated` |
| 13 | `veo:get-anti-spam-status` | `main/main.ts:732` | `GoogleVeoAntiSpamGuard.getInstance().getStatus()` | Không tham số | `Promise<{ status: AntiSpamStatus; guidelines: AntiSpamGuideline[] }>` | `renderer/types/electron.d.ts:263` | Lấy thông số cooldown đếm lùi và trạng thái khóa của bộ chống bot Google |
| 14 | `veo:set-mode` | `main/main.ts:740` | `GoogleVeoSessionManager.getInstance().setMode(mode)` | `event, mode: 'free_session' \| 'api_key' \| 'simulation'` | `Promise<{ ok: boolean }>` | `ApiKeyConfigModal.tsx:319` | Chuyển đổi giữa Sảnh miễn phí, Google API Key chính thức, hoặc Giả lập offline |
| 15 | `veo:get-credits` | `main/main.ts:745` | `GoogleVeoSessionManager.getInstance().getCachedOrFreshCredits(maxAgeMs)` | `event, maxAgeMs?: number` | `Promise<number \| null>` | `renderer/types/electron.d.ts:281` | Đọc số credit khả dụng từ LocalStorage hoặc DOM của Google Flow |
| 16 | `veo:show-lobby-debug` | `main/main.ts:749` | `GoogleVeoSessionManager.getInstance().showLobbyForDebug()` | Không tham số | `Promise<boolean>` | `ApiKeyConfigModal.tsx:246` | Đưa cửa sổ `lobbyWindow` từ tọa độ offscreen (`-3000, -3000`) về giữa màn hình (`100, 100`) để quan sát |
| 17 | `veo:hide-lobby-offscreen` | `main/main.ts:753` | `GoogleVeoSessionManager.getInstance().hideLobbyOffscreen()` | Không tham số | `Promise<boolean>` | `ApiKeyConfigModal.tsx:240` | Đẩy cửa sổ `lobbyWindow` về chế độ offscreen (`-3000, -3000`) để chạy ngầm |
| 18 | `veo:is-lobby-debug` | `main/main.ts:757` | `GoogleVeoSessionManager.getInstance().isLobbyDebug()` | Không tham số | `Promise<boolean>` | `ApiKeyConfigModal.tsx:109` | Kiểm tra cửa sổ lobby có đang hiển thị trên màn hình chính hay không |

### B.3. Miền Character & Scene Bible (Knowledge Base)

| STT | Kênh IPC | File & Dòng | Handler Function | Tham số nhận | Kiểu trả về | Điểm gọi UI |
|:---:|---|---|---|---|---|---|
| 19 | `bible:getCharacters` | `main/workflow/ipc.ts:66` | `BibleStore.getCharacters()` | Không tham số | `Promise<CharacterProfile[]>` | `CharacterBibleModal.tsx:82` |
| 20 | `bible:saveCharacter` | `main/workflow/ipc.ts:70` | `BibleStore.saveCharacter(profile)` | `event, profile` | `Promise<CharacterProfile>` | `CharacterBibleModal.tsx:141` |
| 21 | `bible:deleteCharacter` | `main/workflow/ipc.ts:77` | `BibleStore.deleteCharacter(id)` | `event, id: string` | `Promise<boolean>` | `CharacterBibleModal.tsx:173` |
| 22 | `bible:getScenes` | `main/workflow/ipc.ts:82` | `BibleStore.getScenes()` | Không tham số | `Promise<SceneProfile[]>` | `SceneBibleModal.tsx:74` |
| 23 | `bible:saveScene` | `main/workflow/ipc.ts:86` | `BibleStore.saveScene(profile)` | `event, profile` | `Promise<SceneProfile>` | `SceneBibleModal.tsx:131` |
| 24 | `bible:deleteScene` | `main/workflow/ipc.ts:93` | `BibleStore.deleteScene(id)` | `event, id: string` | `Promise<boolean>` | `SceneBibleModal.tsx:163` |

### B.4. Miền Cài đặt, Tác vụ & File I/O Hỗ trợ

| STT | Kênh IPC | File & Dòng | Handler Function | Mô tả nghiệp vụ |
|:---:|---|---|---|---|
| 25 | `settings:get` | `main/main.ts:489` | `SettingsStore.get(key)` | Đọc cấu hình ứng dụng (`geminiApiKey`, `veoMode`, `exportDir`...) |
| 26 | `settings:set` | `main/main.ts:496` | `SettingsStore.set(key, value)` | Ghi cấu hình ứng dụng |
| 27 | `dialog:openImageFile` | `main/main.ts:1013` | `dialog.showOpenDialog(...)` | Hộp thoại chọn ảnh nguồn / reference image cho node |
| 28 | `dialog:openVideoFile` | `main/main.ts:1028` | `dialog.showOpenDialog(...)` | Hộp thoại chọn video cục bộ đưa vào workflow |
| 29 | `dialog:openMediaFile` | `main/main.ts:928` | `dialog.showOpenDialog(...)` | Hộp thoại chọn tệp media tổng hợp (video, audio) |
| 30 | `dialog:showInFolder` | `main/main.ts:950` | `shell.showItemInFolder(path)` | Mở vị trí file trên Windows Explorer |
| 31 | `dialog:openFolder` | `main/main.ts:971` | `shell.openPath(folderPath)` | Mở thư mục trên hệ điều hành |
| 32 | `dialog:chooseDirectory`| `main/main.ts:1043` | `dialog.showOpenDialog(...)` | Hộp thoại chọn thư mục xuất kết quả mặc định |
| 33 | `files:readImageAsDataUrl`| `main/main.ts:983` | `fs.readFileSync -> Base64` | Đọc file ảnh chuyển thành Data URL hiển thị trên Canvas node |
| 34 | `tasks:runPipeline` | `main/main.ts:359` | `enqueuePipeline(id)` | Đưa 1 task vào hàng đợi pipeline xử lý |
| 35 | `tasks:runPipelineBatch`| `main/main.ts:368` | Vòng lặp `enqueuePipeline(id)` | Đưa danh sách task vào hàng đợi pipeline (tối đa 2 tác vụ song song) |
| 36 | `tasks:updated` *(Push)* | `main/main.ts:183` | `mainWindow.webContents.send` | Broadcast danh sách task thay đổi trạng thái về UI |
| 37 | `app:log` *(Push)* | `main/helpers/logger.ts:92` | `win.webContents.send` | Chuyển tiếp log từ Main Process sang Renderer DevTools |

---

## C. CÁC PHƯƠNG PHÁP AUTOMATION ĐANG TỒN TẠI: TỶ LỆ PHỐI HỢP VÀ CƠ CHẾ ĐỊNH VỊ

### C.1. Bảng Thống kê Tỷ lệ Phối hợp Các Phương pháp Automation

Toàn bộ các tương tác trình duyệt được phân tích chi tiết trên toàn bộ codebase:

| Phương pháp Automation | Số lần xuất hiện | Tỷ lệ % | Hiện trạng & Đánh giá |
|---|:---:|:---:|---|
| **DOM Selectors & JS Evaluation** (`querySelector`, `querySelectorAll`, `.click()`, `execCommand`, `localStorage`) | 68 vị trí | **70.8%** | Chiếm ưu thế tuyệt đối. Dùng trong 18 state của State Machine, các hàm kiểm tra visible, đếm text, dọn canvas, bắt link CDN ảnh/video. |
| **Dynamic Bounding-Box Native Mouse Events** (`sendInputEvent` với toạ độ tính từ `getBoundingClientRect()`) | 15 lần gọi | **15.6%** | Gửi sự kiện chuột OS thật (`mouseMove`, `mouseDown`, `mouseUp`) tại điểm tâm phần tử sau khi đo đạc toạ độ động tức thời. |
| **Native Keyboard Events** (`sendInputEvent` phím `Escape`, `Enter`) | 9 lần gọi | **9.4%** | Gửi phím cứng OS để đóng dialog/overlay (`Escape`) hoặc kích hoạt submit (`Enter`). |
| **Hardcoded Coordinate Clicks** (Click chuột mù tại toạ độ X, Y pixel cố định) | **0 lần** | **0.0%** | **KHÔNG CÓ bất kỳ cú click chuột nào dùng toạ độ pixel cứng**. 100% toạ độ click chuột đều là toạ độ động được đo đạc tức thời tại runtime. |
| **Hardcoded Window Offscreen Coordinates** | 4 tham chiếu hằng số | **4.2%** | Hằng số `OFFSCREEN_X = -3000, OFFSCREEN_Y = -3000` và flip tạm onscreen `(100, 100)` phục vụ GPU capture buffer. |
| **OCR / Visual Template Matching** | **0 lần** | **0.0%** | Không dùng OCR định vị UI. (Module OCR trong `main/ocr/` là Tesseract dùng để trích xuất phụ đề từ video người dùng tải lên). |
| **CDP (Chrome DevTools Protocol) Direct Calls** | **0 lần** | **0.0%** | Không sử dụng `webContents.debugger.attach()`. Toàn bộ thông qua `executeJavaScript` và `sendInputEvent`. |

#### Danh mục Chi tiết 24 Vị trí Gọi `sendInputEvent` Trong Mã Nguồn:
1. `main/veo/GoogleVeoSessionManager.ts:982, 984`: Phím `Escape` (down/up) khi đóng sảnh login.
2. `main/veo/GoogleVeoSessionManager.ts:1085, 1091, 1099`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `cand.rect` của nút New Project.
3. `main/veo/GoogleVeoSessionManager.ts:1294, 1296, 1298`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `cand.rect` của tab Mode (Image/Video).
4. `main/veo/GoogleVeoSessionManager.ts:1315, 1317, 1319`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `cand.rect` của nút Settings Trigger.
5. `main/veo/GoogleVeoSessionManager.ts:1337, 1339, 1341`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `cand.rect` của Aspect Ratio toggle.
6. `main/veo/GoogleVeoSessionManager.ts:1356, 1358, 1360`: Chuột `mouseMove`, `mouseDown`, `mouseUp` tại `cand.rect` của Output Count toggle.
7. `main/veo/GoogleVeoSessionManager.ts:1381, 1383`: Phím `Escape` (down/up) đóng popover settings.
8. `main/veo/GoogleVeoSessionManager.ts:1905, 1913`: Chuột `mouseDown`, `mouseUp` tại `fillResult.btnCoords` (tính từ `getBoundingClientRect()`).
9. `main/veo/GoogleVeoSessionManager.ts:1973, 1975`: Phím `Enter` (down/up) bổ trợ submission video cũ.
10. `main/veo/GoogleVeoSessionManager.ts:2425, 2433`: Chuột `mouseDown`, `mouseUp` tại `res.coords` trong auto-confirm permission.
11. `main/veo/GoogleVeoSessionManager.ts:2497, 2499`: Phím `Escape` (down/up) trong `ensureCleanCanvasReady`.
12. `main/veo/GoogleVeoSessionManager.ts:2510, 2512`: Chuột `mouseDown`, `mouseUp` tại `cand.rect` của nút Close Overlay.
13. `main/veo/GoogleVeoSessionManager.ts:2614, 2622`: Chuột `mouseDown`, `mouseUp` tại `cleanResult.coords` để focus ô prompt trống.
14. `main/workflow/flow-engine/FlowOverlayDetector.ts:174, 175`: Phím `Escape` (down/up) bước 1 của Overlay dismissal.
15. `main/workflow/flow-engine/FlowOverlayDetector.ts:220, 221`: Phím `Escape` (down/up) bước 4 của Overlay dismissal.
16. `main/workflow/flow-engine/states/FlowImageGenerationStates.ts:1155, 1163`: Chuột `mouseDown`, `mouseUp` tại `clickInfo.coords` (tính từ fresh `getBoundingClientRect()` tức thời tại State 14: `CLICK_GENERATE`).
17. `main/workflow/flow-engine/states/FlowImageGenerationStates.ts:1262, 1264`: Phím `Enter` (down/up) tại State 15: `VERIFY_GENERATION_STARTED`.

### C.2. Đánh giá 4 Cơ Chế Định Vị Nâng Cao

#### 1. Container Scoping (Cô Lập Phạm Vi Tìm Kiếm)
- **Hiện thực**: `FlowElementFinder.ts:94-103`. Nếu selector rule khai báo `containerSelector`, script bắt buộc tìm container cha trước. Nếu container cha không tồn tại hoặc không hiển thị, trả về `null` ngay lập tức, **tuyệt đối không quét ra ngoài document-wide**.
- **Mức độ bao phủ**: Áp dụng thành công cho 6 bộ đặc tả chính (`CLEAR_CANVAS_BUTTON`, `NEW_PROJECT_BUTTON`, `MODE_TAB`, `SETTINGS_TRIGGER_BUTTON`, `ASPECT_RATIO`, `OUTPUT_COUNT`).
- **Lỗ hổng rò rỉ phạm vi phát hiện được**:
  - **State 14 (`FlowImageGenerationStates.ts:1069`)**: Tại bước bấm nút Generate (`ClickGenerateState`), hàm `freshCoordJs` quét toàn bộ trang `const allButtons = Array.from(document.querySelectorAll(genBtnSelectors.join(', ')))` mà không giới hạn trong `flow-prompt-box`. Nếu trên trang có modal khác chứa button tương đồng, có thể bị bắt nhầm.
  - **Sinh Video cũ (`GoogleVeoSessionManager.ts:1801`)**: Khi không tìm thấy nút trong prompt box, code cũ tự động rò rỉ tìm kiếm ra document-wide (`if (candidates.length === 0 && scope !== document) { candidates = Array.from(document.querySelectorAll(...)) }`).

#### 2. Short-Text Protection (Phòng Vệ Văn Bản Ngắn)
- **Hiện thực**: `FlowElementFinder.ts:112-115, 158-159, 890`.
  1. Với text $\le 2$ ký tự (`targetText.length <= 2`), chuyển từ tìm kiếm tương đối (`includes`) sang so khớp chính xác tuyệt đối: `txt === targetText || txt === ('x' + targetText)`.
  2. Triệt tiêu điểm thưởng nhãn (+5 điểm) đối với text ngắn.
  3. Cấu hình `baseConfidence: 48` cho text `text:x1` hoặc `text:1`. Sau khi cộng điểm kích thước (+2), tổng điểm đạt tối đa `50/100`. Vì $50 < 65$ (ngưỡng an toàn), `FlowElementFinder` từ chối tương tác với mã lỗi `low_confidence`.
- **Đánh giá**: Hoạt động xuất sắc, triệt tiêu 100% rủi ro false-click vào các số '1', '2' ngẫu nhiên trên giao diện.

#### 3. Dynamic Scoring Algorithm (Thuật Toán Chấm Điểm Tin Cậy 0-100)
- **Phân tầng trọng số cơ sở (Base Confidence)**:
  - Tầng 1 (`ACCESSIBILITY`): **95 điểm** (ARIA label, role - ưu tiên cao nhất).
  - Tầng 2 (`STRICT_COMPONENT`): **88 - 92 điểm** (Custom elements như `flow-prompt-box`, `.ProseMirror`).
  - Tầng 3 (`CONTEXTUAL`): **78 - 80 điểm** (Quan hệ cha con có container scope).
  - Tầng 4 (`TEXT_MATCH`): **68 điểm** (Text dài) hoặc **48 - 55 điểm** (Text ngắn).
  - Tầng 5 (`COORDINATE_FALLBACK`): **50 điểm** (Chỉ bật khi cho phép fallback).
- **Điểm thưởng động**: +5 điểm nếu có label rõ ràng; +2 điểm nếu kích thước $> 20\times 20$ px.
- **Quy tắc Ngắn mạch (Short-circuit Execution)**: Khi một tầng đạt điểm $\ge 65$, vòng lặp dừng ngay lập tức (`break`, dòng 179-181) để tối ưu thời gian phản hồi.
- **Cổng chặn an toàn (Safety Rejection Gate)**: Nếu điểm cao nhất vẫn $< 65$, trả về `{ found: false, error: 'low_confidence' }` và từ chối click.

#### 4. Overlay Detector & Dismissal Pipeline
- **Hiện thực**: `FlowOverlayDetector.ts:31-228`.
- **Nhận diện 4 nhóm overlay**: `AGENT_PANEL` (creative agent dialog), `MODAL_DIALOG` (`mat-dialog-container`), `MEDIA_VIEWER` (`flow-media-viewer`), `BACKDROP` (`.cdk-overlay-backdrop-showing` $> 200\times 200$ px).
- **Quy trình giải phóng 4 bước**:
  1. Gửi phím cứng OS `Escape` -> Chờ 200ms kiểm tra lại.
  2. Click JS vào các nút đóng (`button[aria-label*="Close" i]`, `.close-btn`).
  3. Click JS vào backdrop che mờ.
  4. Gửi phím cứng OS `Escape` lần thứ hai.
- Tích hợp kiểm tra `FlowSmartWait.checkElementUnobscured` sử dụng `document.elementFromPoint(x, y)` đảm bảo tọa độ click không bị che khuất.

---

## D. DANH SÁCH CÁC ĐOẠN CODE TRÙNG LẶP: LOGIC LẶP QUA NHIỀU FILE

| STT | Khối Logic Trùng Lặp | Các File và Dòng Xuất Hiện Trùng | Mô Tả Trùng Lặp & Hậu Quả | Giải Pháp Tối Ưu Hóa |
|:---:|---|---|---|---|
| 1 | **Hàm `safeExecuteJs`** | - `main/veo/GoogleVeoSessionManager.ts:802`<br>- `main/workflow/flow-engine/FlowSmartWait.ts:103`<br>- `main/workflow/flow-engine/states/FlowImageGenerationStates.ts:16` | Khai báo độc lập 3 lần cùng một hàm bọc `win.webContents.executeJavaScript` kèm timeout. Dẫn đến hành vi timeout và log không đồng nhất. | Gom về một hàm tiện ích duy nhất xuất từ `FlowSmartWait.ts`. |
| 2 | **Kiểm tra và giải phóng Overlay** | - `main/workflow/flow-engine/FlowOverlayDetector.ts:170-227`<br>- `main/veo/GoogleVeoSessionManager.ts:2468-2522` | `FlowOverlayDetector` đã có giải pháp 4 bước hoàn chỉnh, nhưng trong `GoogleVeoSessionManager` vẫn tự viết lại logic kiểm tra và gửi Escape thủ công. | Thay thế toàn bộ đoạn code trong `SessionManager` bằng cuộc gọi tới `FlowOverlayDetector.dismiss(win)`. |
| 3 | **Điền Prompt & Gửi Event** | - `FlowImageGenerationStates.ts:455` (State 8)<br>- `GoogleVeoSessionManager.ts:1660` (`fillPromptJs`)<br>- `GoogleVeoSessionManager.ts:2525` (`cleanAndCheckPromptJs`) | Logic chèn text vào ProseMirror bằng clipboard, `document.execCommand('insertText')` và phát sự kiện `input` bị nhân bản 3 lần. | Chuẩn hóa thành `PromptInputHelper.fillPrompt(win, text)`. |
| 4 | **Định vị Cửa sổ Offscreen** | - `GoogleVeoSessionManager.ts:253, 306, 1639, 2423, 2612, 2675` | Lệnh `win.setPosition(OFFSCREEN_X, OFFSCREEN_Y)` bị gọi lặp lại 6 lần rải rác sau mỗi hành động nhỏ. | Gom vào phương thức nội bộ `ensureOffscreenState()`. |
| 5 | **Nhân Bản Lượt Thử Retry Đa Tầng (Multi-Tier Retry Multiplication)** | - `FlowStateMachine.ts:222` (retry tối đa 3 lần/state)<br>- `GoogleFlowImageAdapter.ts:61` (`while retryCount <= 2`) | Tầng trong retry 3 lần, tầng ngoài quấn thêm 2 lần retry toàn phần, tạo ra tới $(1+3)\times(1+2) = 12$ lượt lặp cho cùng một lỗi. | Thống nhất điều phối retry tại duy nhất State Machine; Adapter chỉ bắt kết quả cuối cùng. |

---

## E. CÁC ĐOẠN CODE NGUY HIỂM: HARDCODED COORDINATES, RACE CONDITIONS, LOOPS, LEAKS

Dưới đây là danh mục **10 rủi ro kỹ thuật nghiêm trọng** được xếp theo mức độ ưu tiên từ P0 (chí mạng) đến P2 (cần khắc phục):

### E.1. Nhóm Rủi Ro Chí Mạng (P0 - Critical Vulnerabilities)

1. **Watchdog 12 giây Phá Vỡ Mutex Khóa Trình Duyệt**:
   - **Vị trí**: `main/veo/GoogleVeoAntiSpamGuard.ts`, dòng 106–109.
   - **Mã nguồn**:
     ```typescript
     const watchdog = setTimeout(() => {
       this.releaseLock();
       resolve();
     }, 12_000);
     ```
   - **Cơ chế nguy hiểm**: Khi tác vụ 1 đang sinh video (thời gian render của Veo kéo dài từ 30s đến 120s), tác vụ 2 vào hàng đợi. Sau đúng 12 giây, watchdog tự động giải phóng lock cho tác vụ 2! Tác vụ 2 lập tức chiếm cửa sổ `lobbyWindow`, bắt đầu dọn canvas và gửi click chuột trong khi tác vụ 1 vẫn đang render dở. Hậu quả: Tác vụ 1 bị huỷ hoặc bắt nhầm video của tác vụ 2.
2. **Race Condition Phá Hỏng Giao Diện Đang Sinh từ `veo:get-credits`**:
   - **Vị trí**: `main/main.ts:746` và `main/veo/GoogleVeoSessionManager.ts:894-910, 982-985`.
   - **Cơ chế nguy hiểm**: IPC handler `veo:get-credits` gọi `getCachedOrFreshCredits` **mà KHÔNG hề acquire `GoogleFlowBrowserMutex`**. Khi cache 20 phút hết hạn, hàm `readFlowCredits` tự ý click chuột vào avatar tài khoản Google (`a.gb_A`) trên `lobbyWindow` và gửi phím cứng `Escape`. Nếu đúng lúc đó Workflow đang gõ prompt hoặc chọn menu tỷ lệ khung hình, thao tác click avatar và Escape bất ngờ sẽ phá hỏng toàn bộ quy trình sinh đang chạy!
3. **Thứ Tự Phân Tầng Lỗi Bị Đảo Ngược (Inverted Error Hierarchy)**:
   - **Vị trí**: `main/workflow/flow-engine/FlowStateMachine.ts:161-195`.
   - **Cơ chế nguy hiểm**: Khối `catch (stateErr)` gọi `FlowRecoveryManager.handleRecovery` (chụp màn hình + dump DOM) ở dòng 177 **TRƯỚC KHI** gọi `FlowErrorClassifier.classify` ở dòng 188. Khi gặp lỗi mạng thông thường (`ECONNRESET`, `ETIMEDOUT`), chuỗi lỗi không khớp `obscured/not found/session`, nên biến `errType` bị gán nhầm thành `'UNKNOWN_STATE'`. Hệ thống lập tức flip cửa sổ gây giật màn hình và ghi file HTML/PNG rác vào đĩa trước khi phân loại và retry mạng thành công.

### E.2. Nhóm Rủi Ro Nguy Hiểm Cao (P1 - High Vulnerabilities)

4. **Kẽ Hở Thời Gian (Timing Gap) Gây Vô Hiệu Hóa Idempotency Jump**:
   - **Vị trí**: `main/workflow/flow-engine/states/FlowImageGenerationStates.ts:1096–1175`.
   - **Cơ chế nguy hiểm**: `target.click()` thực thi ở dòng 1096, sau đó tiếp tục vòng lặp lấy toạ độ adaptive polling ở dòng 1121–1133. Đến tận dòng 1175 mới gán `ctx.generateClickedAt = Date.now()`. Nếu Chromium gặp timeout giữa dòng 1096 và 1175, ngoại lệ quăng ra khiến `ctx.generateClickedAt` vẫn bằng 0. Khi rơi vào `FlowRetryManager`, điều kiện Idempotency không thỏa mãn, hệ thống sẽ click nút Generate lần thứ 2, gây duplicate generation.
5. **Video Engine Hoàn Toàn Thiếu Idempotency Guard**:
   - **Vị trí**: `main/workflow/dispatcher/adapters/GoogleFlowVideoAdapter.ts:140-149` và `main/veo/GoogleVeoSessionManager.ts:1393-2169`.
   - **Cơ chế nguy hiểm**: Luồng sinh video dài 760 dòng không dùng State Machine. Khi Veo render quá 240s, hàm trả về null/timeout. Adapter quấn vòng lặp `while (retryCount <= maxInternalRetries)` gọi lại toàn bộ hàm từ đầu, tiếp tục điền prompt và **BẤM NÚT TẠO VIDEO LẦN THỨ 2**, trừ thêm một lượng lớn credit Veo đắt đỏ và tạo 2 video trùng lặp.
6. **Thiếu Handler Crash & Unresponsive Cho `lobbyWindow`**:
   - **Vị trí**: `main/veo/GoogleVeoSessionManager.ts:324-367`.
   - **Cơ chế nguy hiểm**: Cửa sổ `lobbyWindow` không hề đăng ký `render-process-gone` hay `unresponsive`. Khi renderer bị OOM hoặc WebGL crash (rất phổ biến sau nhiều lượt render video nặng), cửa sổ biến thành Zombie (White Screen). Mọi lệnh `safeExecuteJs` sau đó đều timeout vô hạn mà không tự reload/recreate được.
7. **Rò Rỉ Chip Ảnh Tham Chiếu Cũ Trên Canvas (Stale Image Ingredient Chip)**:
   - **Vị trí**: `main/veo/GoogleVeoSessionManager.ts:2460-2648` (`ensureCleanCanvasReady`).
   - **Cơ chế nguy hiểm**: Hàm dọn canvas chỉ xoá text ProseMirror, **hoàn toàn không xoá thẻ `flow-image-ingredient-chip`**. Sau một lượt sinh Image-to-Video, chip ảnh cũ nằm lại vĩnh viễn trong prompt box. Các lượt sinh Text-to-Video tiếp theo bị Google Flow nhận diện nhầm là có ảnh tham chiếu và sinh ra kết quả sai lệch hoàn toàn so với kịch bản.

### E.3. Nhóm Rủi Ro Cần Khắc Phục (P2 - Medium Vulnerabilities)

8. **Cướp Quyền Clipboard Hệ Điều Hành (OS Clipboard Hijacking)**:
   - **Vị trí**: `FlowImageGenerationStates.ts:455-458`.
   - **Cơ chế**: Lệnh `electron.clipboard.writeText(promptClean)` ghi đè prompt vào clipboard của Windows, làm mất dữ liệu clipboard của người dùng đang làm việc ở ứng dụng khác.
9. **Rò Rỉ Đĩa Cứng & Nguy Cơ Crash Đóng Gói (Disk Leak & Packaging Crash)**:
   - **Vị trí**: `FlowRecoveryManager.ts:144, 181`.
   - **Cơ chế**: File DOM HTML (1-4MB) và screenshot PNG (2-5MB) ghi dồn vào `process.cwd()/scratch` không có TTL / dọn dẹp. Khi đóng gói ứng dụng (NSIS vào `C:\Program Files\`), `process.cwd()` là Read-Only sẽ gây lỗi `EPERM/EACCES`, làm crash toàn bộ tiến trình chẩn đoán.
10. **Rò Rỉ Event Listener Khi Mở Đóng Sảnh**:
    - **Vị trí**: `GoogleVeoSessionManager.ts:336-340`.
    - **Cơ chế**: `ses.cookies.on('changed')` được gắn mới mỗi lần mở `lobbyWindow` mà không gỡ bỏ, gây `MaxListenersExceededWarning` và spam hàm sync cookie.

---

## F. CÁC THÀNH PHẦN ĐANG HOẠT ĐỘNG ỔN ĐỊNH CẦN BẢO TỒN

Mặc dù tồn tại các điểm nghẽn về concurrency và video engine, hệ thống đã hoàn thành xuất sắc các module cốt lõi từ Phase 1 đến Phase 6 trong `main/workflow/flow-engine/`. Đây là các tài sản kỹ thuật chất lượng cao **CẦN BẢO TỒN NGUYÊN VẸN**:

| STT | Thành Phần / Module | File & Dòng Code | Lý Do Kỹ Thuật Cần Bảo Tồn Nguyên Vẹn |
|:---:|---|---|---|
| 1 | **GoogleFlowBrowserMutex** | `main/workflow/dispatcher/GoogleFlowBrowserMutex.ts:15-66` | Kiến trúc Promise FIFO chaining kết hợp `AsyncLocalStorage` hỗ trợ Re-entrancy hoàn hảo. Khối `finally` đảm bảo 100% release lock. Cần chọn làm **Chuẩn Mutex Duy Nhất** cho toàn bộ hệ thống. |
| 2 | **Cookie Restoration & Spoofing** | `main/veo/GoogleVeoSessionManager.ts:72-200, 268-296` | Logic `restoreCookiesToPartition`, làm sạch cookie trùng lặp RFC 6265, giả lập User-Agent Windows x64 và loại bỏ `sec-ch-ua` Client Hints vượt qua kiểm tra bot của Google rất ổn định. |
| 3 | **FlowElementFinder (4 Tiers)** | `main/workflow/flow-engine/FlowElementFinder.ts:1-295` | Hệ thống phân tầng chiến lược kết hợp thuật toán tính điểm Confidence Score (0-100), cơ chế ngắn mạch ($\ge 65$) và 11 static search specs cực kỳ vững chắc, loại bỏ hoàn toàn sự phụ thuộc toạ độ. |
| 4 | **Short-Text Confidence Cap** | `main/workflow/flow-engine/FlowElementFinder.ts:112, 890` | Thuật toán so khớp chính xác cho text $\le 2$ ký tự và trần điểm $50 < 65$ triệt tiêu hoàn toàn hiện tượng false-click vào các số '1', '2'. |
| 5 | **FlowSmartWait (5-Layer Stability)** | `main/workflow/flow-engine/FlowSmartWait.ts:18-85, 290-345` | Kiểm tra độ ổn định phần tử qua 2 khung hình liên tiếp với sai số bounding box $\le 1$px, kết hợp kiểm tra unobscured qua `elementFromPoint`, loại bỏ 100% hiện tượng click trượt do layout shift hoặc animation. |
| 6 | **FlowOverlayDetector (4-Step Dismiss)** | `main/workflow/flow-engine/FlowOverlayDetector.ts:31-228` | Cơ chế quét 4 loại overlay và chuỗi giải phóng 4 bước (Escape $\rightarrow$ Close Button $\rightarrow$ Backdrop $\rightarrow$ Escape) giải quyết triệt để vấn đề bị che khuất. |
| 7 | **FlowPageStateDetector** | `main/workflow/flow-engine/FlowPageStateDetector.ts:1-120` | Nhận diện chính xác 7 trạng thái trang web Google Flow (`HOME`, `EDITOR`, `IN_PROGRESS`, `LOGIN_PAGE`, `ERROR_PAGE`...). |
| 8 | **FlowErrorClassifier Taxonomy** | `main/workflow/flow-engine/FlowErrorClassifier.ts:30-325` | Bộ phân loại 13 mã lỗi với 3 category (`FATAL`, `NON_RETRYABLE`, `RETRYABLE`) và Regex trích xuất delay `Retry-After` cho HTTP 429 rất thông minh. |
| 9 | **FlowRetryManager Backoff & Jitter** | `main/workflow/flow-engine/FlowRetryManager.ts:15-90` | Thuật toán Exponential Backoff kết hợp Full Jitter $\pm 20\%$ đạt chuẩn thiết kế hệ phân tán cao cấp. |
| 10 | **CaptureBaselineState & Tagging** | `FlowImageGenerationStates.ts:661-733` | Cơ chế chụp Baseline URL trước khi sinh kết hợp gắn thuộc tính DOM `data-flow-existing` và Time Gate đảm bảo bắt chính xác ảnh mới sinh, không bị nhặt nhầm ảnh cũ. |

---

## G. SƠ ĐỒ KIẾN TRÚC ĐỀ XUẤT: STATE MACHINE + SELF-HEALING + TASK QUEUE

Mô hình kiến trúc tương lai hợp nhất toàn bộ các thành phần đã hoàn thiện từ Phase 1-6 với các trụ cột mới của Phase 7-10:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ RENDERER UI (ReactFlow Canvas + Zustand Store)                                                   │
│   └── Bấm "Run Workflow" / "Batch Generate" / "Resume Task"                                      │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ ipcRenderer.invoke('queue:enqueue' | 'queue:resume')
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PERSISTENT TASK QUEUE ENGINE (TRỌNG TÂM PHASE 7)                                                 │
│   ├── TaskQueueDatabase (SQLite / Atomic JSON Store lưu tại app.getPath('userData')/task_queue)   │
│   │     ├── Bảng `flow_tasks`: id, runId, type ('image'|'video'), priority, payload, status       │
│   │     └── Bảng `flow_checkpoints`: taskId, stepIndex, stateName, activeProjectId,               │
│   │                                  generateClickedAt, capturedMediaUrl, timestamp              │
│   │                                                                                              │
│   ├── TaskQueueDispatcher (Bộ điều phối hàng đợi bền vững)                                       │
│   │     ├── FIFO Priority Worker Pool (Lấy task theo độ ưu tiên)                                 │
│   │     └── Crash Recovery Engine: Quét các task có trạng thái RUNNING / CHECKPOINTED khi app mở │
│   │                                                                                              │
│   └── Unified Concurrency Governor (Hợp nhất Mutex)                                              │
│         ├── GoogleFlowBrowserMutex (Re-entrant FIFO + Timeout: 60s cho Ảnh, 300s cho Video)       │
│         └── AntiSpamGovernor (Chỉ tính toán Human Jitter 2-4s và Cooldown 8s, KHÔNG giữ lock)   │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ dispatch task to pipeline
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ UNIFIED FLOW STATE MACHINE ENGINE                                                                │
│   ├── Pipeline Registry:                                                                         │
│   │     ├── FlowImageGenerationStatePipeline (18 States - Hoàn thiện)                            │
│   │     └── FlowVideoGenerationStatePipeline (18 States - Chuẩn hóa mới từ Video procedural code)│
│   │                                                                                              │
│   ├── Checkpoint Guard (Móc nối tự động tại mỗi bước chuyển State):                              │
│   │     ├── Pre-State Enter: Kiểm tra CheckpointStore xem bước này đã thực hiện xong chưa       │
│   │     ├── Post-State Verify: Ghi nhận Checkpoint xuống đĩa ngay khi Verify đạt tiêu chí        │
│   │     └── Crash Resume Protocol: Áp dụng Quy tắc "ZERO DUPLICATE CLICK":                      │
│   │           └── Nếu Checkpoint đã ghi nhận GENERATION_STARTED (generateClickedAt > 0),          │
│   │               BẮT BUỘC nhảy cóc (Idempotency Jump) thẳng sang State WAIT_FOR_GENERATION      │
│   │                                                                                              │
│   ├── 4 Lớp Tự Phục Hồi & Điều Hướng Chuẩn:                                                      │
│   │     ├── [Lớp 1] FlowErrorClassifier (Phân loại lỗi ĐẦU TIÊN: Mạng vs Fatal vs DOM)          │
│   │     ├── [Lớp 2] FlowRecoveryManager (Chỉ kích hoạt DOM Healing / Dismiss Overlay khi cần)    │
│   │     ├── [Lớp 3] FlowRetryManager (Exponential Backoff + Jitter + Idempotency Jump)           │
│   │     └── [Lớp 4] Diagnostic Engine (Chỉ chụp ảnh/dump DOM khi không thể cứu vãn ➔ Abort)     │
│   │                                                                                              │
│   └── Diagnostic & Storage Manager (Quản lý dung lượng đĩa):                                     │
│         └── app.getPath('userData')/diagnostics (TTL 7 ngày, tối đa 50MB, tối đa 20 file gần nhất)│
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ sendInputEvent at fresh dynamic rect
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ CHROMIUM WEBCONTENTS / DOM DRIVER (lobbyWindow)                                                  │
│   ├── Crash & Unresponsive Watchdog: webContents.on('render-process-gone') ➔ auto-recreate      │
│   └── Clean Canvas Protocol: Xóa text + xóa chip ảnh cũ + không cướp Clipboard OS                │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3 Nguyên Tắc Bất Khả Xâm Phạm Của Kiến Trúc Mới:
1. **Zero Duplicate Click (Tuyệt Đối Không Click Nút Generate Lần Thứ Hai)**:
   - Nếu `ctx.generateClickedAt > 0` hoặc task phục hồi từ Checkpoint `GENERATION_STARTED`, State Machine cấm quay lại State 1 đến 14, bắt buộc nhảy cóc sang State 16 (`WaitForGenerationState`).
2. **Persistent Durability (Bền Vững Trước Mọi Sự Cố Sập Nguồn/Tắt Ứng Dụng)**:
   - Mọi trạng thái hàng đợi và tiến độ thực thi phải được lưu đĩa cục bộ, cho phép Resume chính xác điểm dừng khi mở lại app.
3. **Single Unified Mutex (Một Mutex Duy Nhất Toàn Ứng Dụng)**:
   - Mọi thao tác động tới `lobbyWindow` (bao gồm lấy credit, dọn canvas, sinh ảnh, sinh video) bắt buộc phải đi qua `GoogleFlowBrowserMutex.runExclusive()` với thời gian timeout bảo vệ.

---

## H. LỘ TRÌNH MIGRATION THEO TỪNG BƯỚC NHỎ (PHASE 1 ĐẾN PHASE 10)

Đánh giá toàn diện 10 Phase và các hiệu chỉnh cần thiết cho giai đoạn tiếp theo:

| Phase | Tên Giai Đoạn | Hiện Trạng Code | Đánh Giá Kỹ Thuật | Nhiệm Vụ Cần Điều Chỉnh Cho Phase Tiếp Theo |
|:---:|---|:---:|---|---|
| **Phase 1** | Audit Kiến Trúc & Định Hình Lộ Trình | 🟢 Hoàn thành | Đã nhận diện toàn bộ rủi ro toạ độ cứng, fixed sleep. | Bảo lưu kết quả. |
| **Phase 2** | State Machine + Verify-After-Action + Idempotency | 🟢 Hoàn thành | Đã xây dựng 18 states cho Image Pipeline. | **Cần mở rộng sang Video** (chưa có State Machine). |
| **Phase 3** | Smart Wait + 5-Layer Stability Check | 🟢 Hoàn thành | `FlowSmartWait` kiểm tra bounding box $\le 1$px cực kỳ ổn định. | Bảo lưu nguyên vẹn, tái sử dụng cho Video. |
| **Phase 4** | Self-Healing Element Finder & Scoring | 🟢 Hoàn thành | 4 Tiers + Dynamic Confidence Scoring + Short-Text Protection. | Vá lỗi rò rỉ truy vấn toàn trang tại State 14. |
| **Phase 5** | Recovery Manager + Overlay Detector + Page State | 🟢 Hoàn thành | Đóng overlay 4 bước, phát hiện 7 page states. | **Sửa lỗi thứ tự gọi**: Chuyển Classifier lên trước Recovery. |
| **Phase 6** | Retry Manager + Error Classification Tập Trung | 🟢 Hoàn thành | Exponential Backoff + Jitter + Idempotency Jump. | **Vá lỗi Timing Gap** ở State 14 (set cờ trước khi click). |
| **Phase 7** | **Task Queue & Checkpoints Resume** | 🔴 **Chưa bắt đầu** | Chưa có thư mục `checkpoints/`. Hàng đợi đang là in-memory. | **TRỌNG TÂM TIẾP THEO**: Xây dựng persistent queue, checkpoint resume, migrate Video sang State Machine, dọn chip ảnh cũ. |
| **Phase 8** | Observability, Debug Bundle & File Hash Verification | 🔴 Chưa bắt đầu | Đã có một phần code chụp chẩn đoán ở Phase 5. | Xuất debug zip tự động, quản lý TTL 7 ngày cho diagnostics, kiểm tra tính toàn vẹn SHA-256 của file tải về. |
| **Phase 9** | Selector Memory / Learning + Visual Fallback | 🔴 Chưa bắt đầu | Tuỳ chọn (chỉ làm nếu DOM thay đổi liên tục). | Bộ nhớ ghi nhớ selector thành công và thị giác máy tính fallback. |
| **Phase 10** | Stress Testing & Memory Leak Hardening | 🔴 Chưa bắt đầu | Chưa chạy kiểm thử tải dài hạn. | Chạy liên tục 20 task video/ảnh để đo rò rỉ RAM Chromium và xác minh Mutex không bị stall. |

---

## I. BƯỚC ĐẦU TIÊN NHỎ NHẤT CÓ GIÁ TRỊ CAO NHẤT ĐỂ TIẾP TỤC (PHASE 7 SCOPE & AC)

Để hệ thống đạt độ tin cậy sản phẩm (Production-Ready) mà không làm xáo trộn các module đang chạy tốt, **Phase 7 (Task Queue & Checkpoint Resume)** là bước đi có giá trị cao nhất.

### I.1. Phạm Vi Triển Khai Cụ Thể Của Phase 7 (6 Hạng Mục Cốt Lõi)

1. **Khởi tạo `TaskQueueStore` & `CheckpointManager` Lưu Đĩa**:
   - Tạo thư mục `main/workflow/flow-engine/checkpoints/`.
   - Lưu trữ hàng đợi và checkpoint dưới dạng Atomic JSON Store tại `path.join(app.getPath('userData'), 'flow_task_queue.json')`.
2. **Ghi Checkpoint Tại 3 Mốc Sinh Tử**:
   - `Mốc 1 (PROJECT_READY)`: Đã mở project Google Flow, lưu `activeProjectId`.
   - `Mốc 2 (GENERATION_STARTED)`: Đã gửi click native thành công và xác nhận spinner. Lưu `generateClickedAt` và `generationState = 'GENERATING'`.
   - `Mốc 3 (MEDIA_CAPTURED)`: Đã bắt được URL CDN hoặc Blob dữ liệu.
3. **Khắc Phục Triệt Để Kẽ Hở Timing Gap & Rò Rỉ Phạm Vi Tại State 14**:
   - Đánh dấu cờ `ctx.generationState = 'STARTING'` và `ctx.generateClickedAt = Date.now()` **NGAY TRƯỚC** khi dispatch bất kỳ lệnh click nào.
   - Bắt buộc giới hạn truy vấn tìm nút Generate trong container `flow-prompt-box`.
4. **Hợp Nhất và Tăng Cường Mutex (`GoogleFlowBrowserMutex`)**:
   - Xóa bỏ watchdog 12s trong `GoogleVeoAntiSpamGuard.ts`.
   - Bổ sung `timeoutMs` (60s cho Ảnh, 300s cho Video) vào `GoogleFlowBrowserMutex.runExclusive`.
   - Bọc Mutex cho `getCachedOrFreshCredits` (`veo:get-credits`) để không làm gián đoạn workflow.
5. **Nâng Cấp `ensureCleanCanvasReady` Dọn Dẹp Chip Ảnh Tham Chiếu Cũ**:
   - Bổ sung logic quét và click xoá thẻ `flow-image-ingredient-chip`.
   - Thay thế việc ghi đè clipboard OS bằng giả lập sự kiện DOM.
6. **Đóng Gói `FlowVideoGenerationStatePipeline` Cho Sinh Video**:
   - Chuyển đổi 760 dòng mã tuần tự của `generateVideoViaBrowserContext` thành 18 State tường minh chạy trên `FlowStateMachine`, mang lại đầy đủ khả năng Verify-After-Action và Idempotency Jump cho Video.

### I.2. Tiêu Chí Nghiệm Thu Phase 7 (Acceptance Criteria - AC)

| Mã AC | Tiêu Chí Nghiệm Thu | Phương Pháp Kiểm Chứng Tự Động | Kết Quả Mong Đợi |
|:---:|---|---|---|
| **AC-1** | **Crash & Resume An Toàn** | Chạy task tạo ảnh, ngắt tiến trình Electron ngay sau khi click Generate (Mốc 2). Mở lại ứng dụng và gọi `queue.resume()`. | State Machine đọc Checkpoint, **bỏ qua State 1-14**, nhảy cóc thẳng sang State 16 (`WAIT_FOR_GENERATION`), lấy ảnh thành công mà **KHÔNG click Generate lần 2**. |
| **AC-2** | **Loại Bỏ Watchdog Bug** | Đưa 2 task video vào hàng đợi cách nhau 5 giây. Task 1 render trong 40 giây. | Task 2 kiên nhẫn chờ trong hàng đợi suốt 40 giây; **tuyệt đối không chiếm cửa sổ sau 12 giây**. |
| **AC-3** | **An Toàn Khi Kiểm Tra Credit** | Cho workflow đang gõ prompt trong sảnh, cùng lúc UI gọi liên tục IPC `veo:get-credits`. | Cuộc gọi lấy credit xếp hàng sau Mutex, **không làm mất focus hoặc đứt quãng chuỗi gõ prompt**. |
| **AC-4** | **Dọn Sạch Chip Ảnh Tham Chiếu** | Chạy 1 task Image-to-Video, sau đó chạy ngay 1 task Text-to-Video với prompt mới. | `ensureCleanCanvasReady` xoá sạch chip ảnh cũ; task Text-to-Video sinh ra video mới chuẩn xác, **không bị dính ảnh tham chiếu cũ**. |
| **AC-5** | **Bảo Vệ Clipboard Hệ Điều Hành** | Đặt chuỗi bí mật `"MY_PRIVATE_KEY"` vào clipboard OS. Chạy tự động hoá sinh ảnh. | Sau khi sinh ảnh xong, kiểm tra `clipboard.readText()` **vẫn giữ nguyên `"MY_PRIVATE_KEY"`**, không bị ghi đè prompt vào. |
| **AC-6** | **Giới Hạn Dung Lượng Diagnostics** | Kích hoạt cố tình 25 lỗi chẩn đoán liên tiếp. | Thư mục `diagnostics` nằm trong `userData`, chỉ giữ lại tối đa 20 file gần nhất; tổng dung lượng không vượt quá 50MB. |
| **AC-7** | **Xử Lý Sự Cố Renderer Crash** | Gọi lệnh `webContents.forcefullyCrashRenderer()` trên `lobbyWindow` trong khi đang chạy. | Handler `render-process-gone` phát hiện kịp thời, tiêu huỷ cửa sổ cũ và tái tạo cửa sổ mới mà **không làm treo ứng dụng**. |
| **AC-8** | **Video State Machine Hoàn Chỉnh** | Chạy kiểm thử sinh video với `FlowVideoGenerationStatePipeline`. | Video render thành công qua 18 trạng thái, có log chi tiết từng state, thời gian chạy và URL CDN được xác thực. |

---

## TỔNG KẾT BÁO CÁO

Báo cáo kiểm toán này đã rà soát toàn diện và khách quan toàn bộ hệ thống tự động hóa Google Flow qua 4 góc nhìn chuyên sâu:
1. **DOM & Locator**: 100% toạ độ click chuột là toạ độ động đo tức thời; loại bỏ hoàn toàn toạ độ pixel cứng; Short-Text và Scoring hoạt động xuất sắc.
2. **Session & Concurrency**: Đã phát hiện và chỉ rõ lỗi watchdog 12s phá vỡ Mutex, race condition lấy credit và sự cố rò rỉ chip ảnh tham chiếu cũ trên canvas.
3. **Error & Recovery**: Đã chỉ rõ thứ tự xử lý lỗi bị đảo ngược, kẽ hở timing gap làm mất Idempotency và nguy cơ ghi đĩa rác vào `process.cwd()/scratch`.
4. **IPC & Architecture**: Đã lập danh mục 37 kênh IPC, vẽ sơ đồ luồng dữ liệu 5 lớp, nhận diện sự bất đối xứng giữa Image và Video, và định hình bản thiết kế chuẩn mực cho Phase 7.

Hệ thống đã sẵn sàng bước vào triển khai **Phase 7 (Task Queue & Checkpoint Resume)** theo đúng phạm vi và tiêu chí nghiệm thu đã được chuẩn hóa ở trên.
