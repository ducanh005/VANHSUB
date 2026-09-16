# BÁO CÁO KIỂM TOÁN CHUYÊN SÂU: IPC ENTRY POINTS & KIẾN TRÚC TỔNG THỂ GOOGLE FLOW AUTOMATION
**Chuyên trách**: Track 4 — IPC & Architecture Lead Specialist  
**Ngày kiểm toán**: 2026-09-16  
**Chế độ**: READ-ONLY AUDIT (Tuyệt đối không sửa đổi mã nguồn, không thay đổi git status)  
**Tài liệu tham chiếu chính**:
- `d:\DEAN\DEAN\VANHSUB\FLOW_ENGINE_README.md`
- `d:\DEAN\DEAN\VANHSUB\main\workflow\flow-engine\README.md`
- `d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md`
- `d:\DEAN\DEAN\VANHSUB\.agents\specialist_ipc_arch\DISPATCH.md`

---

## 1. OBSERVATION (QUAN SÁT THỰC NGHIỆM VÀ DỮ LIỆU ĐO ĐẠC)

### 1.1. Danh mục IPC Entry Points (Renderer ➔ Main Process)

Qua rà soát toàn diện mã nguồn, toàn bộ hệ thống IPC của ứng dụng được tập trung tại hai file backend chính (`main/main.ts` và `main/workflow/ipc.ts`), được bridge qua `main/preload.ts` và định kiểu trong `renderer/types/electron.d.ts`.

Dưới đây là Bảng danh mục toàn diện tất cả các kênh IPC, phân loại theo miền nghiệp vụ:

#### A. Miền Workflow, Flow Engine & AI Automation Generation
| STT | Kênh IPC (Channel Name) | File & Dòng (Main Process) | Handler Function | Tham số nhận (Params) | Kiểu dữ liệu trả về (Return Type) | Điểm gọi UI (Renderer Caller) | Mô tả nghiệp vụ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `workflow:run` | `main/workflow/ipc.ts:14` | `engine.execute(graph, callback)` | `event: IpcMainInvokeEvent, graph: WorkflowGraphData` | `Promise<{ success: boolean; outputs: Record<string, any>; error?: string }>` | `renderer/components/workflow/WorkflowCanvas.tsx:416` (`window.vanhsub.workflow.run`) | Tiếp nhận đồ thị DAG từ UI Canvas, kiểm tra chu trình (Kahn's algo) và điều phối các node qua `WorkflowExecutionEngine` |
| 2 | `workflow:runNode` | `main/workflow/ipc.ts:28` | `engine.executeNode(graph, nodeId, callback)` | `event: IpcMainInvokeEvent, graph: WorkflowGraphData, nodeId: string` | `Promise<{ success: boolean; output?: any; error?: string }>` | `renderer/lib/store/workflowStore.ts:316` (`window.vanhsub.workflow.runNode`) | Thực thi đơn lẻ một node trong workflow (chạy thử node tạo ảnh/video/prompt) |
| 3 | `workflow:cancel` | `main/workflow/ipc.ts:42` | `engine.cancel(workflowId)` | `_event: IpcMainInvokeEvent, workflowId: string` | `Promise<boolean>` | `renderer/components/workflow/WorkflowCanvas.tsx:791` (`window.vanhsub.workflow.cancel`) | Hủy bỏ luồng thực thi workflow đang chạy; loại bỏ `workflowId` khỏi `activeRuns` |
| 4 | `workflow:compareFrames` | `main/workflow/ipc.ts:48` | `QcEngine.evaluate(frameA, frameB, config)` | `_event, frameAPath: string, frameBPath: string, config?: QcConfig` | `Promise<{ passed: boolean; score: number; colorDelta: number; status: 'pass'\|'warn'\|'fail'; details: string }>` | `renderer/types/electron.d.ts:360` (`window.vanhsub.workflow.compareFrames`) | So khớp chất lượng khung hình (Quality Control) giữa các video clip |
| 5 | `workflow:concatClips` | `main/workflow/ipc.ts:56` | `VideoProcessor.concatVideos(clipPaths, dest)` | `_event, clipPaths: string[], outPath?: string` | `Promise<string>` | `renderer/components/workflow/MasterTimeline.tsx:116` (`window.vanhsub.workflow.concatClips`) | Ghép nối các đoạn video clip được sinh ra thành timeline hoàn chỉnh bằng FFmpeg |
| 6 | `workflow:getVideoDuration` | `main/workflow/ipc.ts:61` | `VideoProcessor.getVideoDuration(videoPath)` | `_event, videoPath: string` | `Promise<number>` | `renderer/types/electron.d.ts:368` (`window.vanhsub.workflow.getVideoDuration`) | Đọc độ dài video (giây) qua FFprobe |
| 7 | `workflow:node-event` *(Push Event)* | `main/workflow/ipc.ts:20, 34` | `webContents.send('workflow:node-event', nodeEvent)` | `nodeEvent: WorkflowNodeEvent` (nodeId, status, progress, outputData, error) | `void` | `renderer/components/workflow/WorkflowCanvas.tsx:301` (`window.vanhsub.workflow.onNodeEvent`) | Bắn sự kiện tiến độ realtime từ Execution Engine lên UI để cập nhật trạng thái node trên Canvas |

#### B. Miền Quản lý Session Google Veo / Flow Sảnh & Anti-Spam
| STT | Kênh IPC (Channel Name) | File & Dòng (Main Process) | Handler Function | Tham số nhận (Params) | Kiểu dữ liệu trả về (Return Type) | Điểm gọi UI (Renderer Caller) | Mô tả nghiệp vụ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 8 | `veo:open-lobby` | `main/main.ts:697` | `GoogleVeoSessionManager.getInstance().openLobbyWindow(mainWindow)` | Không tham số | `Promise<{ ok: boolean; error?: string }>` | `renderer/components/workflow/WorkflowCanvas.tsx:185`, `ApiKeyConfigModal.tsx:144` | Khởi tạo hoặc focus cửa sổ `lobbyWindow` (partition `persist:google_veo`) để người dùng đăng nhập tài khoản Google |
| 9 | `veo:status` | `main/main.ts:706` | `GoogleVeoSessionManager.getInstance().getStatus()` | Không tham số | `Promise<VeoStatusPayload>` (mode, hasSession, sessionStatus, email, credits, antiSpam) | `renderer/components/workflow/WorkflowCanvas.tsx:167`, `ApiKeyConfigModal.tsx:97` | Trả về thông tin trạng thái phiên làm việc hiện tại, email đăng nhập và hạn mức credit |
| 10 | `veo:validate` | `main/main.ts:710` | `GoogleVeoSessionManager.getInstance().validateSession()` | Không tham số | `Promise<{ valid: boolean; status: string; detail: string; email?: string; lastChecked: number }>` | `renderer/components/workflow/ApiKeyConfigModal.tsx:163` | Kiểm tra kết nối thật tới `https://flow.google.com/` để xác nhận session còn sống hay đã hết hạn |
| 11 | `veo:save-session` | `main/main.ts:714` | `GoogleVeoSessionManager.getInstance().saveManualSession(rawInput)` | `_event, rawInput: string` | `Promise<{ ok: boolean; result?: any; error?: string }>` | `renderer/components/workflow/ApiKeyConfigModal.tsx:203` | Nhập chuỗi cookie thủ công hoặc token xác thực từ bên ngoài |
| 12 | `veo:clear-session` | `main/main.ts:723` | `GoogleVeoSessionManager.getInstance().clearSession()` | Không tham số | `Promise<{ ok: boolean; error?: string }>` | `renderer/components/workflow/ApiKeyConfigModal.tsx:224` | Xóa sạch cookie trong partition và thiết lập trạng thái về `unauthenticated` |
| 13 | `veo:get-anti-spam-status` | `main/main.ts:732` | `GoogleVeoAntiSpamGuard.getInstance().getStatus()` | Không tham số | `Promise<{ status: AntiSpamStatus; guidelines: AntiSpamGuideline[] }>` | `renderer/types/electron.d.ts:263` (`window.vanhsub.veo.getAntiSpamStatus`) | Lấy thông số cooldown đếm lùi và trạng thái khóa của bộ chống bot Google |
| 14 | `veo:set-mode` | `main/main.ts:740` | `GoogleVeoSessionManager.getInstance().setMode(mode)` | `_event, mode: 'free_session' \| 'api_key' \| 'simulation'` | `Promise<{ ok: boolean }>` | `renderer/components/workflow/ApiKeyConfigModal.tsx:319` | Chuyển đổi giữa chế độ Sảnh miễn phí, Google API Key chính thức, hoặc Giả lập offline |
| 15 | `veo:get-credits` | `main/main.ts:745` | `GoogleVeoSessionManager.getInstance().getCachedOrFreshCredits(maxAgeMs)` | `_event, maxAgeMs?: number` | `Promise<number \| null>` | `renderer/types/electron.d.ts:281` (`window.vanhsub.veo.getCredits`) | Đọc số credit khả dụng từ LocalStorage hoặc DOM của Google Flow |
| 16 | `veo:show-lobby-debug` | `main/main.ts:749` | `GoogleVeoSessionManager.getInstance().showLobbyForDebug()` | Không tham số | `Promise<boolean>` | `renderer/components/workflow/ApiKeyConfigModal.tsx:246` | Đưa cửa sổ `lobbyWindow` từ tọa độ offscreen (`-9999, -9999`) về giữa màn hình để người dùng quan sát trực quan |
| 17 | `veo:hide-lobby-offscreen` | `main/main.ts:753` | `GoogleVeoSessionManager.getInstance().hideLobbyOffscreen()` | Không tham số | `Promise<boolean>` | `renderer/components/workflow/ApiKeyConfigModal.tsx:240` | Đẩy cửa sổ `lobbyWindow` về chế độ offscreen (`-9999, -9999`) để chạy ngầm |
| 18 | `veo:is-lobby-debug` | `main/main.ts:757` | `GoogleVeoSessionManager.getInstance().isLobbyDebug()` | Không tham số | `Promise<boolean>` | `renderer/components/workflow/ApiKeyConfigModal.tsx:109` | Kiểm tra cửa sổ lobby có đang hiển thị trên màn hình chính hay không |

#### C. Miền Character & Scene Bible (Knowledge Base Cho Workflow)
| STT | Kênh IPC (Channel Name) | File & Dòng (Main Process) | Handler Function | Tham số nhận (Params) | Kiểu dữ liệu trả về (Return Type) | Điểm gọi UI (Renderer Caller) | Mô tả nghiệp vụ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 19 | `bible:getCharacters` | `main/workflow/ipc.ts:66` | `BibleStore.getCharacters()` | Không tham số | `Promise<CharacterProfile[]>` | `renderer/components/workflow/CharacterBibleModal.tsx:82`, `Inspector.tsx:46` | Lấy danh sách hồ sơ nhân vật (Prompt, LoRA, ảnh tham chiếu) |
| 20 | `bible:saveCharacter` | `main/workflow/ipc.ts:70` | `BibleStore.saveCharacter(profile)` | `_event, profile: Partial<CharacterProfile> & { name: string }` | `Promise<CharacterProfile>` | `renderer/components/workflow/CharacterBibleModal.tsx:141` | Tạo mới hoặc cập nhật thông tin nhân vật |
| 21 | `bible:deleteCharacter` | `main/workflow/ipc.ts:77` | `BibleStore.deleteCharacter(id)` | `_event, id: string` | `Promise<boolean>` | `renderer/components/workflow/CharacterBibleModal.tsx:173` | Xóa hồ sơ nhân vật |
| 22 | `bible:getScenes` | `main/workflow/ipc.ts:82` | `BibleStore.getScenes()` | Không tham số | `Promise<SceneProfile[]>` | `renderer/components/workflow/SceneBibleModal.tsx:74`, `Inspector.tsx:50` | Lấy danh sách hồ sơ bối cảnh (Lighting, Camera angle, Style) |
| 23 | `bible:saveScene` | `main/workflow/ipc.ts:86` | `BibleStore.saveScene(profile)` | `_event, profile: Partial<SceneProfile> & { name: string }` | `Promise<SceneProfile>` | `renderer/components/workflow/SceneBibleModal.tsx:131` | Lưu hoặc sửa đổi bối cảnh |
| 24 | `bible:deleteScene` | `main/workflow/ipc.ts:93` | `BibleStore.deleteScene(id)` | `_event, id: string` | `Promise<boolean>` | `renderer/components/workflow/SceneBibleModal.tsx:163` | Xóa hồ sơ bối cảnh |

#### D. Miền Cài đặt, Tác vụ & Tài nguyên Tệp tin Liên quan
| STT | Kênh IPC (Channel Name) | File & Dòng (Main Process) | Handler Function | Tham số nhận (Params) | Kiểu dữ liệu trả về (Return Type) | Điểm gọi UI (Renderer Caller) | Mô tả nghiệp vụ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 25 | `settings:get` | `main/main.ts:489` | `SettingsStore.get(key)` | `_event, key: keyof AppSettings` | `Promise<any>` | `renderer/components/workflow/WorkflowCanvas.tsx:174`, `OcrConfigModal.tsx:94` | Lấy giá trị cài đặt hệ thống (`geminiApiKey`, `veoMode`, `exportDir`...) |
| 26 | `settings:set` | `main/main.ts:496` | `SettingsStore.set(key, value)` | `_event, key: keyof AppSettings, value: any` | `Promise<boolean>` | `renderer/pages/home.tsx:105`, `OcrConfigModal.tsx:202` | Lưu cấu hình ứng dụng |
| 27 | `dialog:openImageFile` | `main/main.ts:1013` | `dialog.showOpenDialog(...)` | Không tham số | `Promise<string \| null>` | `renderer/components/workflow/Inspector.tsx:149`, `GenericCategoryNode.tsx:73` | Hộp thoại chọn file ảnh nguồn (Keyframe / Reference image cho node ảnh) |
| 28 | `dialog:openVideoFile` | `main/main.ts:1028` | `dialog.showOpenDialog(...)` | Không tham số | `Promise<string \| null>` | `renderer/components/workflow/Inspector.tsx:132`, `GenericCategoryNode.tsx:82` | Hộp thoại chọn video cục bộ đưa vào workflow |
| 29 | `dialog:openMediaFile` | `main/main.ts:928` | `dialog.showOpenDialog(...)` | Không tham số | `Promise<string[] \| null>` | `renderer/components/workflow/Inspector.tsx:136`, `home.tsx:176` | Hộp thoại chọn tệp media tổng hợp (video, audio) |
| 30 | `dialog:showInFolder` | `main/main.ts:950` | `shell.showItemInFolder(filePath)` | `_event, filePath: string` | `Promise<void>` | `renderer/components/workflow/nodes/GenericCategoryNode.tsx:531, 605, 754` | Mở thư mục chứa file đầu ra trên Explorer Windows |
| 31 | `dialog:openFolder` | `main/main.ts:971` | `shell.openPath(folderPath)` | `_event, folderPath: string` | `Promise<void>` | `renderer/pages/home.tsx:325`, `ExportPage.tsx:421` | Mở thư mục trên hệ điều hành |
| 32 | `dialog:chooseDirectory` | `main/main.ts:1043` | `dialog.showOpenDialog(...)` | Không tham số | `Promise<string \| null>` | `renderer/components/SettingsPage.tsx:314` | Chọn thư mục xuất file mặc định |
| 33 | `files:readImageAsDataUrl` | `main/main.ts:983` | `fs.readFileSync(...) -> Base64 dataURL` | `_event, filePath: string` | `Promise<string \| null>` | `renderer/components/workflow/nodes/GenericCategoryNode.tsx:199, 556` | Đọc file ảnh từ ổ cứng chuyển thành chuỗi Data URL để hiển thị preview trên thẻ ReactFlow Node |
| 34 | `tasks:runPipeline` | `main/main.ts:359` | `enqueuePipeline(id)` + `drainPipelines()` | `_event, id: string, opts?: { replaceAudio?: boolean }` | `Promise<boolean>` | `renderer/pages/home.tsx:365` | Chạy toàn bộ pipeline xử lý media cho 1 task |
| 35 | `tasks:runPipelineBatch` | `main/main.ts:368` | Vòng lặp `enqueuePipeline(id)` | `_event, ids: string[]` | `Promise<number>` | `renderer/pages/home.tsx:384` | Đưa danh sách các task vào hàng đợi pipeline chạy song song (tối đa 2 tác vụ) |
| 36 | `tasks:updated` *(Push Event)* | `main/main.ts:183` | `mainWindow.webContents.send('tasks:updated', TaskStore.getAll())` | `TaskStore.getAll()` | `void` | `renderer/pages/home.tsx:165` (`window.vanhsub.tasks.onUpdate`) | Broadcast danh sách task thay đổi trạng thái về UI |
| 37 | `app:log` *(Push Event)* | `main/helpers/logger.ts:92` | `win.webContents.send('app:log', entry)` | `entry: { level: string; text: string; ts: number }` | `void` | `main/preload.ts:143` (`window.vanhsub.logs.onLog`) | Forward toàn bộ log của Main Process về Renderer Console |

---

### 1.2. Hiện Trạng Cốt Lõi Kiến Trúc Điều Phối (Architecture Duality & Discrepancies)

Qua việc kiểm tra luồng chạy từ IPC xuống phần cứng, phát hiện các hiện tượng kỹ thuật đặc biệt sau:

1. **Sự tồn tại song song của hai Bộ máy Workflow Graph**:
   - `WorkflowExecutionEngine` tại `main/workflow/executionEngine.ts` (1,062 dòng): Là bộ engine đang **được IPC kết nối thực tế** (`main/workflow/ipc.ts:10`). Engine này sử dụng `AdapterRegistry` tại `main/workflow/adapters/AdapterRegistry.ts` và gọi thẳng `GoogleFlowAdapter.ts`.
   - `WorkflowGraphEngine` tại `main/workflow/dispatcher/WorkflowGraphEngine.ts` (615 dòng): Là bộ engine điều phối nâng cao hỗ trợ nhánh điều kiện (`conditional`), vòng lặp (`loop`), `SharedStateStore` và `NodeAdapterRegistry`. Tuy nhiên, engine này **chưa hề được đăng ký vào `main/workflow/ipc.ts`**, tức là đang bị tách rời khỏi luồng IPC chính thức của người dùng.
2. **Sự phân hoá sâu sắc giữa Luồng Sinh Ảnh (Image) và Luồng Sinh Video**:
   - **Luồng Sinh Ảnh (`generateImageViaBrowserContext`)**: Đã được hiện đại hóa hoàn toàn ở Phase 2 - 6 thông qua `FlowStateMachine` (18 State tường minh, `FlowElementFinder` 4 tầng với Confidence Scoring, `FlowRecoveryManager`, `FlowRetryManager` có Exponential Backoff và Idempotency Jump).
   - **Luồng Sinh Video (`generateVideoViaBrowserContext`)**: Nằm tại `main/veo/GoogleVeoSessionManager.ts:1393-2169` (gần 800 dòng code thủ tục liên tục). Luồng này **chưa được chuyển đổi sang `FlowStateMachine`**, vẫn sử dụng cấu trúc `executeJavaScript` thủ tục, fixed sleep rải rác, và bắt đầu xuất hiện sự pha trộn giữa mã cũ và các cuộc gọi `FlowElementFinder` chắp vá ở bước cấu hình (`configureGoogleFlowSettings`).
3. **Sự phân mảnh của cơ chế Đồng thì (Concurrency Management)**:
   - Hệ thống có tới 4 cơ chế quản lý đồng thì hoạt động hoàn toàn độc lập:
     - `GoogleFlowBrowserMutex` (`main/workflow/dispatcher/GoogleFlowBrowserMutex.ts`): Mutex in-memory dựa trên chuỗi Promise + `AsyncLocalStorage`.
     - `GoogleVeoAntiSpamGuard` (`main/veo/GoogleVeoAntiSpamGuard.ts`): Hàng đợi in-memory `queue: Array<{ resolve, reject }>` với độ trễ jitter và cooldown chống bot.
     - `OnlineImageRateLimiter` (`main/workflow/adapters/GoogleFlowAdapter.ts:34-59`): Hàng đợi in-memory giãn cách 2.5s chống HTTP 429.
     - `pipelineQueued` / `pipelineActive` (`main/main.ts:291-313`): Hàng đợi in-memory tối đa 2 pipeline song song.
   - **Đặc điểm quan sát**: Tất cả các hàng đợi này đều nằm hoàn toàn trong RAM (in-memory). Khi ứng dụng Electron bị tắt, crash, hoặc người dùng khởi động lại máy, **toàn bộ trạng thái hàng đợi và task đang chạy đều biến mất**, không có bất kỳ cơ chế lưu vết đĩa nào để khôi phục.
4. **Vị trí hiện tại của Lộ trình 10 Phase**:
   - `FLOW_ENGINE_README.md` và `main/workflow/flow-engine/README.md` xác nhận:
     - **Phase 1 đến Phase 6**: Đã code hoàn tất 100%, có đầy đủ bộ kiểm thử Unit Test, Adversarial Test và Live Run thực tế trên Google Flow với log thật từ Electron (Phase 4 đã duyệt; Phase 5 và Phase 6 đang có kết quả kiểm thử hoàn chỉnh chờ User phê duyệt).
     - **Phase 7 (Task Queue & Checkpoint Resume)**: **Hoàn toàn chưa được xây dựng**; thư mục `main/workflow/flow-engine/checkpoints/` chưa tồn tại trong hệ thống tệp tin.

---

## 2. LOGIC CHAIN (CHUỖI SUY LUẬN TỪ QUAN SÁT ĐẾN KẾT LUẬN)

1. **Từ Quan sát 1.1 và 1.2.1**:
   - Kênh IPC `workflow:run` trong `main/workflow/ipc.ts` khởi tạo trực tiếp instance của `WorkflowExecutionEngine` (`const engine = new WorkflowExecutionEngine()`).
   - Mọi yêu cầu từ UI ReactFlow Canvas đều truyền qua `WorkflowExecutionEngine` ➔ `AdapterRegistry` ➔ `GoogleFlowAdapter`.
   - `WorkflowGraphEngine` (chứa các tính năng nâng cao về branch/loop trong `dispatcher/`) hiện là một nhánh kiến trúc độc lập chưa được tích hợp vào IPC. Nếu không hợp nhất hai engine này trước khi triển khai Task Queue ở Phase 7, hệ thống sẽ gặp tình trạng "chia cắt logic": một bên có Queue nhưng thiếu tính năng đồ thị nâng cao, hoặc ngược lại.

2. **Từ Quan sát 1.2.2**:
   - `FlowImageGenerationStatePipeline` gồm 18 trạng thái đã vận hành rất ổn định cho ảnh (`run_phase6_live.ts` hoàn thành 35.4s, có bằng chứng ảnh CDN và xác nhận DOM).
   - Ngược lại, sinh video trong `GoogleVeoSessionManager.ts:1393` vẫn là khối mã đơn khối khổng lồ. Mặc dù các chức năng `FlowElementFinder`, `FlowRecoveryManager`, và `FlowErrorClassifier` đã sẵn sàng, chúng chưa được đóng gói thành một `FlowVideoGenerationStatePipeline`.
   - Điều này dẫn đến sự mất cân bằng về độ tin cậy: việc sinh ảnh có khả năng tự phục hồi, chống false-click và chống double-charge (Idempotency), trong khi việc sinh video vẫn đối mặt với rủi ro coordinate drift, timeout không rõ nguyên nhân và rò rỉ trạng thái.

3. **Từ Quan sát 1.2.3**:
   - 4 cơ chế xếp hàng và kiểm soát đồng thì (`BrowserMutex`, `AntiSpamGuard`, `RateLimiter`, `PipelineQueue`) đều lưu trữ trong bộ nhớ heap của Node.js process.
   - Khi một tác vụ sinh video hoặc ảnh đang chạy dở (mất 30s - 120s) mà xảy ra sự cố (ngắt mạng, crash tiến trình Chromium, người dùng vô tình đóng cửa sổ chính), hệ thống không lưu lại Checkpoint nào xuống đĩa.
   - Khi khởi động lại ứng dụng, hệ thống không thể biết tác vụ đó đã được Google bấm nút Generate hay chưa. Kết quả là khi người dùng bấm chạy lại, hệ thống sẽ thực hiện lại từ đầu, bấm Generate thêm lần nữa, dẫn đến tiêu tốn gấp đôi credit hoặc tài khoản bị Google phát hiện hành vi bất thường.

4. **Từ Quan sát 1.2.4**:
   - Việc chuyển từ Phase 6 sang Phase 7 đòi hỏi phải giải quyết triệt để vấn đề "Tính bền vững của tác vụ" (Task Durability & Crash Recovery).
   - Nền tảng của Phase 6 đã cung cấp sẵn `FlowErrorClassifier` (nhận biết lỗi mạng tạm thời) và `Idempotency Jump` (nhảy cóc qua bước click nếu generation đã in-flight). Đây chính là 2 viên gạch hoàn hảo để Phase 7 xây dựng `CheckpointStore` và `TaskQueue`.

---

## 3. SƠ ĐỒ KIẾN TRÚC HIỆN TẠI VÀ 5 LỚP TRỪU TƯỢNG (END-TO-END ARCHITECTURE)

### 3.1. Sơ đồ Luồng Dữ liệu Toàn trình Hiện tại (Data Flow Map)

```
[ LỚP 1: UI / PRESENTATION LAYER ]
  │
  ├── WorkflowCanvas.tsx (ReactFlow UI, Drag-and-Drop Nodes, Graph Runner Toolbar)
  ├── Inspector.tsx (Hiệu chỉnh prompt, aspect ratio, model parameters)
  ├── MasterTimeline.tsx (Ghép clip, timeline preview)
  ├── ApiKeyConfigModal.tsx (Cấu hình Session, Google Lobby Login, Anti-Spam Guard UI)
  └── workflowStore.ts (Quản lý Zustand state: graphId, nodes[], edges[], runtimeMap)
        │
        ▼ (window.vanhsub.workflow.run / window.vanhsub.veo.*)
[ LỚP 2: PRELOAD BRIDGE & IPC LAYER ]
  │
  ├── main/preload.ts (contextBridge.exposeInMainWorld('vanhsub', ...))
  │     ├── vanhsub.workflow: run, runNode, cancel, concatClips, onNodeEvent
  │     ├── vanhsub.veo: openLobby, status, validate, saveSession, getCredits...
  │     └── vanhsub.tasks: getAll, create, update, runPipeline...
  │
  ├── main/workflow/ipc.ts (ipcMain.handle: 'workflow:run', 'workflow:runNode', 'workflow:cancel')
  │     └── event.sender.send('workflow:node-event', nodeEvent)
  └── main/main.ts (ipcMain.handle: 'veo:*', 'tasks:*', 'dialog:*', 'settings:*')
        │
        ▼ (engine.execute(graph, onEvent))
[ LỚP 3: SERVICE / ORCHESTRATION LAYER ]
  │
  ├── WorkflowExecutionEngine.ts (Kahn's DAG Topo Sort, Cycle Detection, Node Dispatcher)
  │     │   [⚠️ DISCREPANCY: WorkflowGraphEngine.ts trong dispatcher/ chưa được IPC gọi]
  │     ▼
  ├── AdapterRegistry.ts (Quản lý các ModelAdapter) ➔ GoogleFlowAdapter.ts
  │     │
  │     ├── OnlineImageRateLimiter.ts (Giãn cách 2.5s in-memory chống HTTP 429)
  │     ├── GoogleVeoAntiSpamGuard.ts (In-memory FIFO Queue, Auto Cooldown 8s, Human Jitter 2-4s)
  │     └── GoogleFlowBrowserMutex.ts (In-memory Promise Lock + AsyncLocalStorage Re-entrancy)
  │           │
  │           ▼ (sessionMgr.generateImageViaBrowserContext / generateVideoViaBrowserContext)
[ LỚP 4: AUTOMATION & ENGINE LAYER ]
  │
  ├── GoogleVeoSessionManager.ts (Singleton quản lý Session, LobbyWindow, Cookie Sync RFC 6265)
  │     │
  │     ├── [NHÁNH ẢNH: Phase 2 - Phase 6 Standard]
  │     │     ▼
  │     │   FlowStateMachine.ts (18 States Tường Minh: enter ➔ execute ➔ verify ➔ exit)
  │     │     ├── FlowImageGenerationStates.ts (18 states, Idempotency Jump, Verify Data Criteria)
  │     │     ├── FlowElementFinder.ts (4 Tiers: ACCESSIBILITY ➔ STRICT ➔ CONTEXTUAL ➔ TEXT)
  │     │     │     ├── Container-Scoped Search (Zero Document-Wide Leak)
  │     │     │     └── Short-Text Confidence Cap (score <= 50 < 65 Safe Threshold)
  │     │     ├── FlowSmartWait.ts (Adaptive Polling, 5-layer Pre-action Element Stability Check)
  │     │     ├── FlowRecoveryManager.ts (Auto Dismiss Overlay, Panel Handling, DOM Diagnostic Dump)
  │     │     ├── FlowOverlayDetector.ts (Escape key ➔ Close button ➔ Backdrop dismissal)
  │     │     ├── FlowPageStateDetector.ts (7 Page States: HOME, EDITOR, IN_PROGRESS, LOGIN...)
  │     │     ├── FlowErrorClassifier.ts (Phân loại tập trung: RETRYABLE, NON_RETRYABLE, FATAL)
  │     │     └── FlowRetryManager.ts (Exponential Backoff + Full Jitter +-20%, Idempotency Guard)
  │     │
  │     └── [NHÁNH VIDEO: Legacy Procedural Backlog]
  │           ▼
  │         GoogleVeoSessionManager.generateVideoViaBrowserContext() (Thủ tục tuần tự ~800 dòng)
  │           ├── executeJavaScript() trực tiếp (Không có State Machine)
  │           └── Fixed sleeps & thủ tục click phân mảnh
  │
  │           ▼ (sendInputEvent, executeJavaScript, webRequest)
[ LỚP 5: BROWSER / DRIVER LAYER ]
  │
  ├── Electron BrowserWindow (lobbyWindow, partition: 'persist:google_veo', backgroundThrottling: false)
  ├── Chromium webContents:
  │     ├── webContents.sendInputEvent({ type: 'mouseMove' | 'mouseDown' | 'mouseUp', x, y })
  │     ├── webContents.sendInputEvent({ type: 'keyDown' | 'keyUp', keyCode: 'Escape' | 'Enter' })
  │     └── webContents.executeJavaScript(script, true) (Truy vấn DOM, bóc tách CDN Blob, LocalStorage)
  └── Electron Session & Network Interception:
        ├── session.webRequest.onBeforeSendHeaders (Loại bỏ Client Hints / Electron fingerprint)
        ├── session.webRequest.onResponseStarted (Sniffing media URLs thật: flow-content.google/*)
        └── session.cookies (Đồng bộ cookie Google Auth)
```

### 3.2. Đánh giá 5 Lớp Trừu tượng (Abstraction Layers Analysis)

1. **Lớp 1: Giao diện (UI Layer)**:
   - *Thành phần*: ReactFlow Canvas, Zustand Store (`workflowStore.ts`), Inspector, API Key Modal.
   - *Ưu điểm*: Trực quan, giao tiếp bất đồng bộ qua event streaming (`onNodeEvent`), tách biệt hoàn toàn việc render giao diện với backend.
   - *Khuyết điểm*: Thiếu khả năng khôi phục giao diện nếu backend crash giữa chừng; thanh tiến độ chỉ phản ánh tiến độ của lượt chạy hiện thời.
2. **Lớp 2: Cầu nối IPC (IPC & Preload Layer)**:
   - *Thành phần*: `main/preload.ts`, `main/workflow/ipc.ts`, `main/main.ts`.
   - *Ưu điểm*: Tuân thủ nghiêm ngặt chuẩn Electron bảo mật (Context Isolation bật, Node Integration tắt, truyền dữ liệu có cấu trúc qua `contextBridge`).
   - *Khuyết điểm*: Các kênh IPC phân mảnh giữa hai file (`ipc.ts` cho workflow và `main.ts` cho veo/task); thiếu một kênh truy vấn trạng thái hàng đợi nền (`queue:status`, `queue:resume`).
3. **Lớp 3: Điều phối dịch vụ (Service / Orchestration Layer)**:
   - *Thành phần*: `WorkflowExecutionEngine`, `GoogleFlowAdapter`, `GoogleFlowBrowserMutex`, `GoogleVeoAntiSpamGuard`.
   - *Ưu điểm*: Quản lý được thứ tự thực thi đồ thị DAG, phát hiện chu trình, bảo vệ trình duyệt bằng Mutex.
   - *Khuyết điểm*: Phân mảnh giữa `WorkflowExecutionEngine` và `WorkflowGraphEngine`; tất cả hàng đợi đều là in-memory, thiếu tính năng khôi phục sau sự cố (Fault Tolerance).
4. **Lớp 4: Tự động hóa & Máy trạng thái (Automation & Flow Engine Layer)**:
   - *Thành phần*: `FlowStateMachine`, `FlowElementFinder`, `FlowSmartWait`, `FlowRecoveryManager`, `FlowErrorClassifier`, `FlowRetryManager`.
   - *Ưu điểm*: Cực kỳ vững chắc cho luồng Ảnh (Phase 2-6 đạt 100% tiêu chuẩn: 4 tiers selector, verify-after-action, auto recovery, idempotency jump).
   - *Khuyết điểm*: Luồng Video chưa được đưa vào State Machine; chưa có cơ chế lưu vết Checkpoint xuống đĩa (Phase 7).
5. **Lớp 5: Trình duyệt & Phần cứng (Browser / Driver Layer)**:
   - *Thành phần*: Electron `BrowserWindow` (`lobbyWindow`), `webContents`, `persist:google_veo` partition.
   - *Ưu điểm*: Điều khiển chuột/phím mức native (`sendInputEvent`), vượt qua các cơ chế kiểm tra bot của Google nhờ can thiệp header và xóa `navigator.webdriver`.
   - *Khuyết điểm*: Tài nguyên cửa sổ đơn lẻ (`lobbyWindow`), nếu gặp tab crash hoặc render process hang, toàn bộ chuỗi tác vụ phía trên sẽ bị nghẽn.

---

## 4. ĐÁNH GIÁ CHI TIẾT THÀNH TỰU PHASE 1 - 6 VS YÊU CẦU PHASE 7 - 10

### 4.1. Bảng Đánh Giá Hiện Trạng Triển Khai (Phase 1 đến Phase 10)

| Phase | Tên Hạng Mục | Trạng Thái Hiện Tại | Thành Tựu Đã Đạt (Bằng Chứng Cụ Thể) | Khoảng Trống Kiến Trúc Còn Tồn Tại (Gaps) |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | Audit Kiến Trúc & Luồng Hiện Tại | 🟢 **HOÀN THÀNH** | Phân tích toàn bộ điểm yếu coordinate drift, fixed sleep, single selectors, chốt lộ trình 10 Phase. | Không |
| **Phase 2** | State Machine + Verify-After-Action + Idempotency | 🟢 **HOÀN THÀNH** | Triển khai 18 states tường minh cho Image (`FlowImageGenerationStates.ts`), verify bằng dữ liệu DOM thật, chống click duplicate. | Chỉ mới áp dụng cho sinh Ảnh; Video vẫn dùng procedural code. |
| **Phase 3** | Smart Wait + Element Stability Check | 🟢 **HOÀN THÀNH** | `FlowSmartWait.ts`: Polling thích ứng (500-1000ms), kiểm tra 5 lớp (tồn tại, visible, enabled, unobscured, bounding box $\le 1$px). | Cần tối ưu thời gian chờ khi mạng chập chờn. |
| **Phase 4** | Self-Healing Element Finder | 🟢 **HOÀN THÀNH** | `FlowElementFinder.ts`: 4 Tiers + Confidence Scoring (0-100), Container-Scoped Search, Short-Text Confidence Cap (score 50 < 65 threshold). | Chưa mở rộng đầy đủ các spec đặc thù của luồng Video (nút chọn độ dài 4s/6s/8s/10s, tab timeline video). |
| **Phase 5** | Recovery Manager + Overlay Detector + Page State | 🟢 **HOÀN THÀNH** (Đủ log thật, chờ duyệt) | `FlowPageStateDetector.ts` (7 trạng thái), `FlowOverlayDetector.ts` (dismiss 3 bước), `FlowRecoveryManager.ts` (auto-dismiss, dump HTML/screenshot khi UNKNOWN). | Hook tự động phục hồi mới được gắn vào `FlowStateMachine` của Ảnh; Video chưa có hook này. |
| **Phase 6** | Retry Manager + Error Classification Tập Trung | 🟢 **HOÀN THÀNH** (Đủ log thật, chờ duyệt) | `FlowErrorClassifier.ts` (3 nhóm chuẩn hoá), `FlowRetryManager.ts` (Exponential Backoff + Full Jitter $\pm 20\%$, Idempotency Jump on retry). | Chưa có cơ chế lưu lịch sử retry xuống cơ sở dữ liệu đĩa để nối lại khi app restart. |
| **Phase 7** | **Task Queue + Checkpoints Resume** | 🔴 **CHƯA BẮT ĐẦU** | Thư mục `flow-engine/checkpoints/` đã được định nghĩa trong kiến trúc nhưng chưa có code. | **TOÀN BỘ HẠNG MỤC**: Hàng đợi tác vụ bền vững (Persistent Queue), lưu Checkpoint trạng thái máy, khôi phục sau crash. |
| **Phase 8** | Debugging / Observability + Download Verification | 🔴 **CHƯA BẮT ĐẦU** | Đã có một phần code chụp chẩn đoán ở Phase 5 (`FlowRecoveryManager.dumpDiagnostics`). | Cần chuẩn hóa xuất debug bundle (HTML + screenshot + log) tự động và verify hash tính toàn vẹn file tải về. |
| **Phase 9** | Element Memory / Learning + Visual Fallback | 🔴 **CHƯA BẮT ĐẦU** | Tùy chọn (chỉ làm nếu DOM thay đổi liên tục). | Bộ nhớ ghi nhớ selector thành công và thị giác máy tính fallback. |
| **Phase 10** | Stress Test Toàn Bộ | 🔴 **CHƯA BẮT ĐẦU** | Chưa chạy kịch bản dài nhiều node liên tục. | Kiểm thử tải dài hạn (10-20 video/ảnh liên tiếp) để đo rò rỉ bộ nhớ Chromium. |

---

## 5. SƠ ĐỒ KIẾN TRÚC ĐỀ XUẤT (BLUEPRINT): STATE MACHINE + TASK QUEUE + CHECKPOINT RESUME

Nhằm khắc phục toàn bộ các khoảng trống kiến trúc đã phát hiện, sơ đồ kiến trúc chuẩn hóa cho các Phase tiếp theo được đề xuất như sau:

```
[ RENDERER UI ]
  │ Bấm "Run Workflow" / "Run Batch"
  ▼
[ IPC BRIDGE LAYER ]
  │ ipcMain.handle('queue:enqueue') / 'queue:pause' / 'queue:resume' / 'queue:status'
  ▼
[ PERSISTENT TASK QUEUE ENGINE (PHASE 7 CHỦ ĐẠO) ]
  ├── TaskQueueDatabase (SQLite / Atomic JSON Store trên AppData/userData)
  │     ├── Bảng `flow_tasks`: id, runId, type ('image'|'video'), priority, payload, status, createdAt
  │     └── Bảng `flow_checkpoints`: taskId, stepIndex, stateName, activeProjectId, generateClickedAt, capturedMediaUrl, timestamp
  │
  ├── Concurrency Dispatcher (Điều phối đồng thì)
  │     ├── Priority Worker Pool (Lấy task theo FIFO + Priority)
  │     ├── Global Browser Mutex Interlock (Chỉ cho phép 1 task chiếm dụng lobbyWindow tại 1 thời điểm)
  │     └── Cooldown & Anti-Spam Governor (Tích hợp GoogleVeoAntiSpamGuard)
  │
  ▼ (Kích hoạt thực thi Task)
[ UNIFIED FLOW STATE MACHINE (PHASE 7 EXTENSION) ]
  ├── Pipeline Loader:
  │     ├── FlowImageGenerationStatePipeline (18 States - Hoàn thiện)
  │     └── FlowVideoGenerationStatePipeline (18 States - Chuẩn hóa mới từ Video procedural code)
  │
  ├── Checkpoint Guard (Móc nối tại mỗi bước chuyển State):
  │     ├── Trước khi Enter: Kiểm tra CheckpointStore xem bước này đã hoàn thành chưa?
  │     ├── Sau khi Verify Đạt: Ghi Checkpoint tức thì xuống đĩa (`saveCheckpoint`)
  │     └── Khi Gặp Lỗi / Crash / Restart:
  │           └── Resume Engine: Nạp Checkpoint gần nhất -> Thực hiện Idempotency Jump thẳng tới
  │               `WAIT_FOR_GENERATION` nếu `generateClickedAt > 0` (Bảo vệ tuyệt đối chống trừ credit 2 lần!)
  │
  ├── FlowRecoveryManager (Tự phục hồi DOM che phủ, popup cảnh báo)
  ├── FlowErrorClassifier (Phân định RETRYABLE vs NON_RETRYABLE)
  └── FlowRetryManager (Exponential Backoff + Jitter)
        │
        ▼ (sendInputEvent tại fresh getBoundingClientRect)
[ CHROMIUM WEBCONTENTS / DOM ]
```

### Các Đặc Tính Kiến Trúc Cốt Lõi Của Mô Hình Đề Xuất:

1. **Persistent Task Queue (Hàng đợi Bền Vững Độc Lập Với Bộ Nhớ RAM)**:
   - Các yêu cầu tạo ảnh/video không thực thi trực tiếp trên luồng IPC mà được ghi ngay lập tức vào cơ sở dữ liệu đĩa cục bộ (`TaskQueueStore`).
   - Hàng đợi có các trạng thái tường minh: `QUEUED` ➔ `RUNNING` ➔ `CHECKPOINTED` ➔ `COMPLETED` / `FAILED` / `PAUSED`.
   - Nếu người dùng tắt ứng dụng hoặc máy tính mất điện đột ngột, khi mở lại ứng dụng, `TaskQueueEngine` sẽ tự động quét các task có trạng thái `RUNNING` hoặc `CHECKPOINTED` để khôi phục (Resume).

2. **Checkpoint & Resume Protocol (Giao Thức Điểm Kiểm Soát & Khôi Phục An Toàn)**:
   - Ghi Checkpoint tại 3 mốc sinh tử:
     - Mốc 1 (`PROJECT_READY`): Đã mở xong project, lưu `activeProjectId`.
     - Mốc 2 (`GENERATION_STARTED`): Đã gửi click native vào nút Generate và xác nhận spinner/mạng. Lưu `generateClickedAt` và `generationState = 'GENERATING'`.
     - Mốc 3 (`MEDIA_CAPTURED`): Đã bắt được URL CDN hoặc Blob dữ liệu.
   - **Quy tắc Khôi phục Bất khả xâm phạm (Zero Duplicate Click)**: Nếu task khởi động lại mà đã có Checkpoint Mốc 2, State Machine **nghiêm cấm thực thi lại các state từ 1 đến 14**, mà bắt buộc nhảy cóc (Idempotency Jump) thẳng sang State 16 (`WaitForGenerationState`).

3. **Hợp nhất Luồng Video vào State Machine**:
   - Chuyển đổi 800 dòng mã thủ tục của `generateVideoViaBrowserContext` thành `FlowVideoGenerationStatePipeline` gồm 18 states tương đương, tái sử dụng toàn bộ `FlowElementFinder`, `FlowSmartWait`, `FlowRecoveryManager` và `FlowRetryManager`.

---

## 6. CAVEATS (CÁC GIỚI HẠN VÀ ĐIỀU KIỆN BIÊN)

1. **Giới hạn môi trường kiểm tra**: Cuộc kiểm toán này thực hiện ở chế độ `READ-ONLY AUDIT`, dựa trên việc phân tích mã nguồn tĩnh, kiểm tra các bản bundle JavaScript trong `scratch/`, và đối chiếu các file log nghiệm thu thực tế đã được ghi nhận. Không có mã nguồn nào bị thay đổi hay thực thi can thiệp trong phiên này.
2. **Khác biệt giữa Windows và Linux/Mac**: Một số kênh IPC sử dụng đường dẫn tệp tin và lệnh hệ thống (`dialog:showInFolder`, `ffmpeg.setFfmpegPath`). Môi trường kiểm toán hiện tại là Windows 10/11 x64, các hành vi của phím tắt native (`Escape`, `Enter`) qua `sendInputEvent` được tối ưu hóa cho Windows.
3. **Sự phụ thuộc vào cấu trúc DOM của Google**: Mặc dù `FlowElementFinder` đã có 4 tầng phòng thủ và Confidence Scoring, nếu Google Flow thay đổi toàn bộ kiến trúc giao diện từ Angular/Material sang Canvas WebGL thuần túy, các DOM selector sẽ cần bổ sung thêm OCR/Vision Fallback (thuộc phạm vi Phase 9).

---

## 7. CONCLUSION (KẾT LUẬN & KIẾN NGHỊ HÀNH ĐỘNG)

1. **Kết luận Tổng thể**:
   - Hệ thống IPC và kiến trúc của module `flow-engine` đã đạt được bước tiến lớn từ Phase 1 đến Phase 6: Luồng sinh ảnh đã hoàn toàn thoát khỏi sự phụ thuộc vào toạ độ cố định, có State Machine 18 states, có cơ chế tự phục hồi overlay và phân loại lỗi/retry chuẩn mực.
   - Tuy nhiên, hệ thống đang tồn tại **4 nút thắt kiến trúc lớn**:
     1. Luồng sinh Video bị tụt hậu so với luồng Ảnh (chưa có State Machine riêng).
     2. Sự phân mảnh của hai bộ engine (`WorkflowExecutionEngine` vs `WorkflowGraphEngine`).
     3. Toàn bộ cơ chế đồng thì và xếp hàng hiện tại đều là in-memory, thiếu tính năng lưu đĩa.
     4. Chưa có cơ chế Checkpoint Resume để khôi phục khi ứng dụng gặp sự cố.
2. **Kiến nghị hành động cho Phase 7**:
   - Cần triển khai ngay Phase 7 với mục tiêu kép:
     - **Mục tiêu 1**: Xây dựng `TaskQueueStore` và `CheckpointManager` trên đĩa cục bộ.
     - **Mục tiêu 2**: Đóng gói `FlowVideoGenerationStatePipeline` để đồng bộ hoá 100% sức mạnh của State Machine cho cả Video lẫn Image.

---

## 8. VERIFICATION METHOD (PHƯƠNG PHÁP XÁC MINH ĐỘC LẬP)

Để các chuyên gia và Orchestrator có thể độc lập xác minh toàn bộ các quan sát trong báo cáo này, thực hiện theo các bước sau:

1. **Xác minh Danh mục IPC**:
   - Mở file `d:\DEAN\DEAN\VANHSUB\main\workflow\ipc.ts` và kiểm tra các dòng 14, 28, 42, 48, 56, 61, 66, 70, 77, 82, 86, 93.
   - Mở file `d:\DEAN\DEAN\VANHSUB\main\main.ts` và kiểm tra các dòng 237, 241, 246, 255, 359, 368, 697-757.
   - Mở file `d:\DEAN\DEAN\VANHSUB\main\preload.ts` để đối chiếu các hàm được phơi bày qua `contextBridge`.
2. **Xác minh Sự Phân Hoá giữa Image và Video**:
   - Kiểm tra `d:\DEAN\DEAN\VANHSUB\main\veo\GoogleVeoSessionManager.ts`:
     - Dòng 2175 - 2240: Hàm `generateImageViaBrowserContext` khởi tạo `new FlowStateMachine(FlowImageGenerationStatePipeline)`.
     - Dòng 1393 - 2169: Hàm `generateVideoViaBrowserContext` là 800 dòng lệnh thủ tục tuần tự, không có State Machine.
3. **Xác minh Hiện Trạng Phase 1 - 6 vs Phase 7**:
   - Đọc `d:\DEAN\DEAN\VANHSUB\main\workflow\flow-engine\README.md` (Bảng điều khiển tiến độ và lịch sử nghiệm thu).
   - Kiểm tra thư mục `d:\DEAN\DEAN\VANHSUB\main\workflow\flow-engine\checkpoints` để xác nhận thư mục này chưa được khởi tạo.
